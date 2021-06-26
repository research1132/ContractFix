const ganache = require("ganache-cli");
const Web3 = require('web3');
const solc = require('solc');
const fs = require('fs');
const parser = require('./solidity-parser-antlr/src/index');
let ganacheConfig = [];
for (var i=0; i<10; i++) {
  ganacheConfig.push({balance: "0xffffffff", gasLimit: "8000000"});
}
const web3Options = {
  defaultBlock: "latest",
  transactionConfirmationBlocks: 1,
  transactionBlockTimeout: 5
};
const provider = ganache.provider(ganacheConfig);
const web3 = new Web3(provider, null, web3Options);

let Blockchain = {
  address: {},
  // init: () => {
  //   return new Promise((resolve, reject) => {
  //     let config = [];
  //     for (var i=0; i<10; i++) {
  //       config.push({balance: "0xffffffff"});
  //     }
  //     web3.setProvider(ganache.provider(config));
  //     web3.eth.getAccounts((err, accs) => {
  //       if (err) reject(err);
  //       accounts = accs;
  //       resolve(accounts);
  //     });
  //   });
  // },

  compile: (filename, text) => {
    let solcOutput = solc.compile({'sources':{[filename]: text}}, 1);
    let contractName = null;
    let ast = parser.parse(text);
    parser.setDepthAndID(ast, true, true);
    parser.visit(ast, {
      ContractDefinition: (node) => {
        contractName = node.name;
      }
    });
    let contract = solcOutput.contracts[filename + ':' + contractName];
    if (!contract) {
      return false;
    } else {
      return true;
    }
  },

  deploy: (filename, text) => {
    return new Promise((resolve, reject) => {
      let solcOutput = solc.compile({'sources':{[filename]: text}}, 1);
      let contractName = null;
      let ast = parser.parse(text);
      parser.setDepthAndID(ast, true, true);
      parser.visit(ast, {
        ContractDefinition: (node) => {
          contractName = node.name;
        }
      })
      let contract = solcOutput.contracts[filename + ':' + contractName];
      let deployContract = new web3.eth.Contract(JSON.parse(contract.interface));
      let deployTransaction = deployContract.deploy({data: contract.bytecode, arguments:[]});
      web3.eth.getAccounts().then((accounts) => {
        console.log("Deploy account", accounts[0])
        return deployTransaction.send({from: accounts[0], gas: 6000000});
      }).then((c) => {
        console.log("Deploy", filename, "success at address", c.options.address);
        Blockchain.address[filename] = c.options.address;
        resolve();
      }).catch((err) => {
        console.log(err);
        reject(err);
      });
    });
  },


  send: (filename, sendData, sendValue, accountId) => {
    return new Promise((resolve, reject) => {
      let addr = Blockchain.address[filename];
      if (!addr) reject();
      web3.eth.getAccounts().then((accounts) => {
        return web3.eth.sendTransaction({from: accounts[accountId], to: addr, data: sendData, value: sendValue});
      }).then((res) => {
        console.log("Transaction", res.transactionHash, "success")
        resolve(true);
      }).catch((err) => {
        console.log(err)
        resolve(false); // we need to check the send status against the status in testsuites, so use resolve(false) rather than reject
      })
    })
  },

  testSuite: async (filename, text, cases, limit=20) => {
    // Use transactions as test cases to test the deployed contract
    // * This function has problems about choosing sender accounts that have not been addressed yet *

    // cases = {
    //   owner: address,
    //   transactions: [
    //     {
    //       from: address,
    //       data: hex,
    //       value: string,
    //       status: string
    //       ...
    //     }, ...
    //   ]
    // }
    // Order of cases.transactions is chronological order (starting from the oldest)

    try{
      let owner = cases.owner;
      let senders = [owner]; // stores all distinct from addresses in cases.transactions
      if (!owner) return false;
      await Blockchain.deploy(filename, text);
      for (let i in cases.transactions) {
        // ** Temporarily use only successful transactions **
        // (failed transactions may causes by problems other than wrong inputs, for instance, too few gas)
        if (cases.transactions[i].status != "Success") continue;

        // Use proper account to send the transaction
        let index = senders.findIndex((e) => { return e == cases.transactions[i].from; });

        // A new sender
        if (index < 0) {
          index = senders.length;
          senders.push(cases.transactions[i].from);
        }

        // Test accounts used up (this is related to the `limit` argument)
        if (index >= 10) {
          console.log("10 test accounts used up")

          // Everything is okay up to the transactions sent from 10 'from' addresses
          break;
        }
        console.log("index new", index)
        console.log("sender new", senders)
        let status = await Blockchain.send(filename, cases.transactions[i].data, web3.utils.toWei(cases.transactions[i].value, 'ether'), index);
        console.log("status:", status)
        console.log(cases.transactions[i].status)
        console.log(!status && cases.transactions[i].status == "Success")
        console.log(status && cases.transactions[i].status == "Fail")
        if ((!status && cases.transactions[i].status == "Success") || (status && cases.transactions[i].status == "Fail")) {
          // Execution status mismatches the status of crawled history transactions

          return false;
        }
        if (i >= limit) break;
      }
      return true;
    } catch (err) {
      console.error(err)
      return false;
    }
  }
}


module.exports = Blockchain;