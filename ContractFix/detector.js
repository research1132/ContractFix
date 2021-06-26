const execSync = require('child_process').execSync;
const config = require('./config')
const fs = require('fs');

// requirements: docker and container of docker
// mount the directory of tmp_contract.sol to container /project
// e.g. docker run --name securify -v $(pwd)/test/tmp:/project securify -json -q

Detector = {
  name: "securify",
  timeout: 1000000,
  init: (containerName="securify", timeout=600000) => {
    Detector.name = containerName;
    Detector.timeout = timeout;
  },

  run: (text) => {
    try {
      fs.writeFileSync(config.tmpContract, text, 'utf-8');
      let stdOut = execSync('docker start -i securify 2>/dev/null');
      return JSON.parse(stdOut);
    } catch (err) {
      return null;
    }
  },

  compare: (oldJson, newJson, label) => {
    let oldCnt = 0;
    let newCnt = 0;
    for (var i in oldJson) {
      oldCnt += oldJson[i]["results"][label]["violations"].length;
    }
    for (var i in newJson) {
      newCnt += newJson[i]["results"][label]["violations"].length;
    }
    return newCnt < oldCnt;
  }
}

module.exports = Detector;