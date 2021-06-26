const path = require('path');

Config = {
  // statList: ['VariableDeclarationStatement', 'IfStatement', 'WhileStatement', 'ForStatement', 'ExpressionStatement', 'EmitStatement', 'ReturnStatement', 'ThrowStatement'],
  writeOperatorList: ['=', '|=', '^=', '&=', '<<=', '>>=', '+=', '-=', '*=', '/=', '%='],
  compareMutationList: ['==', '>', '>=', '!=', '<', '<='],
  sourcePath: path.join(__dirname, "tools/source/"),  // directory of contract source
  detectorPath: path.join(__dirname, "tools/securify/"), // directory storing securify outputs (optional)
  fixPath: path.join(__dirname, "tools/fixsource/"), // directory of fixed source
  logPath: path.join(__dirname, "tools/fixsecurify/"), // directory of new securify outputs
  testPath: path.join(__dirname, "tools/testsuites/"), // directory of test cases
  tmpContract: path.join(__dirname, "tmp/tmp_contract.sol") // tmp file (to be analyzed by securify)
}

module.exports = Config;