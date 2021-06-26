# ContractFix

## Introduction
![Architecture of ContractPatch](architecture.png)
Blockchain allows mutually untrusted parties to run a consensus protocol to agree on the trading 
transactions and maintain a shared ledger of data. While the correct execution of smart contracts is
enforced by the consensus protocol of blockchain, it is challenging to create smart contracts that 
are free of security vulnerabilities. <br>

ContractFix is a novel framework that automatically generates source code patched for vulnerable smart
contracts. ContractFix can incorporate different fix strategies for smart contract vulnerabilities, and
is designed to be a security "fix-it" tool that can automatically apply patches to the vulnerabilities
and verify the patched contracts before the contract deployment.

## Setup
<ol>
<li> Install the Secueify: https://github.com/eth-sri/securify
<li> Install the Slither: https://github.com/crytic/slither
<li> Install the Smartcheck: https://github.com/smartdec/smartcheck
<li> Install the required packages
</ol>

## Input
<ol>
<li> The vulnerable smart contract
<li> processed the static tools' report
</ol>

## Output

The patched contract

