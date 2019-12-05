'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const fs = require('fs-extra');
const path = require('path');
const shell = require('shelljs');

const token = core.getInput('token');

if (!token) {
  throw new Error('Input required and not supplied: token');
}

const throwErrors = err => {
  if (err) {
    throw err;
  }
};

async function main() {
  try {

    // the following is for shell output capture
    let myOutput = '';
    let myError = '';
    const options = {};
    options.listeners = {
      stdout: (data) => {
        myOutput += data.toString();
      },
      stderr: (data) => {
        myError += data.toString();
      }
    };

    // configure git context
    console.log('Configuring git...');
    await exec.exec('git', ['config', '--local', 'user.name', core.getInput('authorName')]);
    await exec.exec('git', ['config', '--local', 'user.email', core.getInput('authorEmail')]);
    fs.writeFileSync(path.join(process.env.HOME, '.netrc'), `
      machine github.com
      login ${process.env.GITHUB_REPOSITORY.replace(/\/.+/, '')}
      password ${token}
      `, throwErrors);

    // throw error if not on master branch
    const CURRENT_REF = github.context.ref;
    let refSplit = CURRENT_REF.split('/');
    const CURRENT_BRANCH = refSplit[refSplit.length - 1];
    console.log(`CURRENT_BRANCH = ${CURRENT_BRANCH}`);
    if (CURRENT_BRANCH != 'master') {
      console.log(`current git branch is not 'master' -- aborting release script`);
      shell.exit(1);
    }
    // otherwise checkout
    await exec.exec('git', ['checkout', CURRENT_BRANCH]);

    console.log('updating version');
    await exec.exec('mvn', ['build-helper:parse-version', 'versions:set', '-DnewVersion=\${parsedVersion.majorVersion}.\${parsedVersion.minorVersion}.\${parsedVersion.incrementalVersion}', 'versions:commit', '--no-transfer-progress']);
    await exec.exec('git', ['add', 'pom.xml']);
    await exec.exec('git', ['commit', '-m', 'GitHub Action: release version']);

    console.log('tagging release version');
    await exec.exec('mvn', ['org.apache.maven.plugins:maven-help-plugin:3.2.0:evaluate', '-Dexpression=project.name', '-q', '-DforceStdout'], options);
    const PROJECT_NAME = myOutput; myOutput = '';
    await exec.exec('mvn', ['org.apache.maven.plugins:maven-help-plugin:3.2.0:evaluate', '-Dexpression=project.version', '-q', '-DforceStdout'], options);
    const PROJECT_VERSION = myOutput; myOutput = '';
    const TAG_NAME = PROJECT_NAME + '-' + PROJECT_VERSION;
    console.log(`Tagging version ${TAG_NAME}`);
    await exec.exec('git', ['tag', '-a', TAG_NAME, '-m', TAG_NAME]);
    await exec.exec('git', ['push', '--follow-tags']);

    console.log('deploying release package');
    await exec.exec('mvn', ['deploy', '--no-transfer-progress']);

    console.log('updating SNAPSHOT version');
    await exec.exec('mvn', ['build-helper:parse-version', 'versions:set', '-DnewVersion=\${parsedVersion.majorVersion}.\${parsedVersion.minorVersion}.\${parsedVersion.nextIncrementalVersion}-SNAPSHOT', 'versions:commit', '--no-transfer-progress']);
    await exec.exec('git', ['add', 'pom.xml']);
    await exec.exec('git', ['commit', '-m', 'GitHub Action: SNAPSHOT version']);
    await exec.exec('git', ['push', 'origin', CURRENT_BRANCH]);

    console.log('...done');
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
