/* eslint-env mocha */
var softMaxWalletUtxos = 3
var ColoredCoinsBuilder = require('..')
var ccb = new ColoredCoinsBuilder({network: 'testnet', softMaxUtxos: softMaxWalletUtxos})
var assert = require('assert')
var clone = require('clone')
var bitcoinjs = require('bitcoinjs-lib')
var Transaction = bitcoinjs.Transaction
var script = bitcoinjs.script
var CC = require('cc-transaction')
var _ = require('lodash')

/* Tests utils */
function outputScriptToAddress(script) {
  return bitcoinjs.address.fromOutputScript(script, bitcoinjs.networks.testnet)
}

// assert helper: I don't know why we need this
async function assertThrowsAsync(fn, regExp) {
  let f = () => {};
  try {
    await fn();
  } catch(e) {
    f = () => {throw e};
  } finally {
    assert.throws(f, regExp);
  }
}

var issueArgs = {
  utxos: [{
    txid: 'b757c9f200c8ccd937ad493b2d499364640c0e2bfc62f99ef9aec635b7ff3474',
    index: 1,
    value: 598595600,
    scriptPubKey: {
      addresses: ['mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY'],
      hex: '76a91477c0232b1c5c77f90754c9a400b825547cc30ebd88ac'
    }
  }],
  issueAddress: 'mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY',
  amount: 3600,
  fee: 5000
}

describe('the issue builder', function () {
  it('args must have utxos field', async function () {
    var args = clone(issueArgs)
    delete args.utxos
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "utxos"/)
  })

  it('args must have fee field', async function () {
    var args = clone(issueArgs)
    delete args.fee
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "fee"/)
  })

  it('args must have issueAddress field', async function () {
    var args = clone(issueArgs)
    delete args.issueAddress
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "issueAddress"/)
  })

  it('args must have amount field', async function () {
    var args = clone(issueArgs)
    delete args.amount
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "amount"/)
  })

  it('returns valid response with default values', async function () {
    var result = await ccb.buildIssueTransaction(issueArgs)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // OP_RETURN + 2 changes
    assert(result.assetId)
    assert.deepEqual(result.coloredOutputIndexes, [2])
    var sumValueInputs = issueArgs.utxos[0].value
    var sumValueOutputs = _.sumBy(tx.outs, function (output) { return output.value })
    assert.equal(sumValueInputs - sumValueOutputs, issueArgs.fee)
    var opReturnScriptBuffer = script.decompile(tx.outs[0].script)[1]
    var ccTransaction = CC.fromHex(opReturnScriptBuffer)
    assert.equal(ccTransaction.type, 'issuance')
    assert.equal(ccTransaction.amount, issueArgs.amount)
    // default values
    assert.equal(ccTransaction.lockStatus, true)
    assert.equal(ccTransaction.divisibility, 0)
    assert.equal(ccTransaction.aggregationPolicy, 'aggregatable')
  })

  it('on injectPreviousOutput returns previous output hex in inputs', async function () {
    var args = clone(issueArgs)
    args.flags = {injectPreviousOutput: true}
    var result = await ccb.buildIssueTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.ins[0].script.toString('hex'), args.utxos[0].scriptPubKey.hex)
  })

  it('should split change', async function () {
    var args = clone(issueArgs)
    args.financeChangeAddress = false
    var result = await ccb.buildIssueTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 2) // OP_RETURN + 1 change
    assert.deepEqual(result.coloredOutputIndexes, [1])
  })
})

var sendArgs = {
  utxos: [
    {
      txid: '9ad3154af0fba1c7ff399935f55680810faaf1e382f419fe1247e43edb12941d',
      index: 0,
      value: 9789000,
      used: false,
      blockheight: 577969,
      blocktime: 1444861908000,
      scriptPubKey: {
        asm: 'OP_DUP OP_HASH160 0e8fffc70907a025e65f0bdbc5ec6bb2d326d3a7 OP_EQUALVERIFY OP_CHECKSIG',
        hex: '76a9140e8fffc70907a025e65f0bdbc5ec6bb2d326d3a788ac',
        reqSigs: 1,
        type: 'pubkeyhash',
        addresses: ['mgqxFyV13aG2HQpnQ2bLKTUwm8wTPtssQ5']
      },
      assets: [
        {
          assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j',
          amount: 500,
          issueTxid: '3b598a4048557ab507952ee5705040ab1a184e54ed70f31e0e20b0be7549cd09',
          divisibility: 2,
          lockStatus: false,
          aggregationPolicy: 'aggregatable'
        }
      ]
    }
  ],
  to: [{ address: 'mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY', amount: 20, assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j' }],
  changeAddress: 'mfuVBQVHpPGiVrAB6MoNaPjiiY1va7f4bc',
  fee: 5000
}

describe('the send builder', function () {

  it('args must have utxos field', async function () {
    var args = clone(sendArgs)
    delete args.utxos
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "utxos"/)
  })

  it('args must have to field', async function () {
    var args = clone(sendArgs)
    delete args.to
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "to"/)
  })

  it('args must have fee field', async function () {
    var args = clone(sendArgs)
    delete args.fee
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "fee"/)
  })

  it('args must have changeAddress field', async function () {
    var args = clone(sendArgs)
    delete args.changeAddress
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "changeAddress"/)
  })

  it('returns valid response with default values', async function () {
    var args = clone(sendArgs)
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + change
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    var sumValueInputs = sendArgs.utxos[0].value
    var sumValueOutputs = _.sumBy(tx.outs, function (output) { return output.value })
    assert.equal(sumValueInputs - sumValueOutputs, sendArgs.fee)
    var opReturnScriptBuffer = script.decompile(tx.outs[1].script)[1]
    var ccTransaction = CC.fromHex(opReturnScriptBuffer)
    assert.equal(ccTransaction.type, 'transfer')
    assert.equal(ccTransaction.payments[0].range, false)
    assert.equal(ccTransaction.payments[0].output, 0)
    assert.equal(ccTransaction.payments[0].input, 0)
    assert.equal(ccTransaction.payments[0].percent, false)
    assert.equal(ccTransaction.payments[0].amount, sendArgs.to[0].amount)
  })

  it('returns valid response with several outputs', async function () {
    var addresses = [
      'mtr98kany9G1XYNU74pRnfBQmaCg2FZLmc',
      'mtrD2mBMp93bc8SmMa9WK6tteUCtYEuQQz',
      'mtr98kany9G1XYNU74pRnfBQmaCg2FZLmc',
      'mivV5HAfYpBQRy7BNUPMWHKAnEg7yVT5Wh',
      'mtr98kany9G1XYNU74pRnfBQmaCg2FZLmc',
      'n1utwqxiwFn6p6P4fjBytbwNWvFUy5tKVq',
      'mtr98kany9G1XYNU74pRnfBQmaCg2FZLmc',
      'mpp9gLXWszG4FwPM8pUEUTiqHAcUc99J5Y',
      'muEK4mzoFJ8XpwTZ6Nj87g7RJbTjjrhZTC',
      'mtaqc9M2svVynsrSunGV9LN63YcWYPGAaD',
      'mtmxEhx1ucf2k9XofrgmsthWnYmKeLXU1c',
      'mwxkhhJUnS8TUiaMB1Gmfk3zu2QJuHcEiV',
      'mhhzCzpJSz7LiRWwSSjQEZ4NsLKvBzY2sK',
      'n2ug8FVg4oBBb4qyMVPwzqj4QowHuM9Hi1',
      'n15wwcX6Zgu7krWV1EXEdSLLTeCvUutvTM',
      'mni9h4mUNsdiGBSJQoMdzeKsCXmTvxxvid',
      'miQ7sSXkmoek3ZcwhZHNCFnVfncTs341UC',
      'miYMk1nKQQWVmMH5xsJRKyqEnHfJf9pEeF',
      'msNcXmKjLYKgMM9TiyQjAvJ69w1L63Zp4N',
      'myhb6JeUJy1JvyVuq5tXJZbADU6EMH24vo',
      'n13Utk1gZv65R9hmBPd2B7m5v4P2gZvwrG',
      'mhKnKtPFCbYpC61buDMgSBB57mqiWvXCUo',
      'my6kMPNS5MdtfDMF9NLXNjkpkHokvoT3qR',
      'mhKnKtPFCbYpC61buDMgSBB57mqiWvXCUo',
      'mjKZeM23nEu7qViqTT3Nd6KCQYcw58WhGc',
      '2N3GSnGbfS36M7u6dynXVyBcbPs9mCUHwEM',
      '2NC8ftGyT9YhZbKvvqFwC8rct4dbqiCyGCM',
      'mxFfdSEbQtqe5GLzLiFFENeRYufomdtFhc',
      'mn5aNzZ2PeaopcyeMxzz7K5k2WK27e6oEm',
      'mqEk4DsCoVMav9NiEjCxJsEHnNGvity8Pz',
      'n2gmBqufUfkcfPF1iKkRM41gaFZLHhmCjL',
      'n27rLEmKU4AbVKntw3mkyQzjGSvXrdpAqc',
      'n1nB1jCx9ABDPvsdbw7AptyZK1WP55xY3X',
      'mzj9s6mgvCRhzmgVQk27K1L5tNhU2nkA3A'
    ]

    var args = clone(sendArgs)
    for (var address of addresses) {
      args.to.push({ address: address, amount: 1, assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j' })
    }
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    Transaction.fromHex(result.txHex)
  })

  it('on injectPreviousOutput returns previous output hex in inputs', async function () {
    var args = clone(sendArgs)
    args.flags = {injectPreviousOutput: true}
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.ins[0].script.toString('hex'), args.utxos[0].scriptPubKey.hex)
  })

  it('should not split change', async function () {
    var args = clone(sendArgs)
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + 1 change
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    assert.equal(outputScriptToAddress(tx.outs[2].script), sendArgs.changeAddress)
  })

  it('should split change', async function () {
    var args = clone(sendArgs)
    var btcAddr = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
    args.bitcoinChangeAddress = btcAddr
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [0, 3])
    assert.equal(outputScriptToAddress(tx.outs[2].script), btcAddr, 'bitcoin change')
    assert.equal(outputScriptToAddress(tx.outs[3].script), sendArgs.changeAddress, 'assets change')
  })

  it('should accept placeholder changes addresses', async function () {
    var args = clone(sendArgs)
    args.changeAddress = "placeholder"
    args.bitcoinChangeAddress = "placeholder"
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [0, 3])
  })

  it('should have only asset change', async function () {
    var args = clone(sendArgs)
    var btcAddr = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
    args.bitcoinChangeAddress = btcAddr
    // Spend all in fees
    args.fee = args.utxos[0].value - 654 * 2
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + assets change
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    assert.equal(outputScriptToAddress(tx.outs[2].script), sendArgs.changeAddress, 'assets change')
  })

  it('should have only bitcoin change', async function () {
    var args = clone(sendArgs)
    var btcAddr = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
    args.bitcoinChangeAddress = btcAddr
    // Send a whole utxo, so asset change can be avoided
    args.to[0].amount = sendArgs.utxos[0].assets[0].amount
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + bitcoin change
    assert.deepEqual(result.coloredOutputIndexes, [0])
    assert.equal(outputScriptToAddress(tx.outs[2].script), btcAddr, 'bitcoin change')
  })

  function addUtxos(args, n) {
    for (var i=1; i<=n; i++) {
      args.utxos.push(clone(args.utxos[0]))
      args.utxos[i].index = i
    }
  }

  describe('coin selection', function() {

    function expectedNumberOfUtxos(utxos, softMaxUtxos) {
      var overSize = utxos.length - softMaxUtxos
      if (overSize > 1) {
        return Math.floor(Math.log2(overSize))
      } else {
        return 1
      }
    }

     async function test(args) {
      var btcAddr = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      args.bitcoinChangeAddress = btcAddr
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.ok(tx.ins.length)
      if (tx.ins.length < expectedNumberOfUtxos(args.utxos, softMaxWalletUtxos))
        assert.fail()
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      var sumValueInputs = 0
      // The vout of inputs define the binded utxo, because vouts are unique
      tx.ins.forEach((input) => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function (output) { return output.value })
      assert.equal(sumValueInputs - sumValueOutputs, sendArgs.fee)
      var opReturnScriptBuffer = script.decompile(tx.outs[1].script)[1]
      var ccTransaction = CC.fromHex(opReturnScriptBuffer)
      assert.equal(ccTransaction.type, 'transfer')
      assert.equal(ccTransaction.payments[0].range, false)
      assert.equal(ccTransaction.payments[0].output, 0)
      assert.equal(ccTransaction.payments[0].input, 0)
      assert.equal(ccTransaction.payments[0].percent, false)
      assert.equal(ccTransaction.payments[0].amount, args.to[0].amount)
    }

    it('should work with small utxo set', async function() {
      // small means utxos.length <= softMaxUtxos
      var args = clone(sendArgs)
      await test(args)
    })
    it('should work with a larger utxo set', async function() {
      // larger means utxos.length === softMaxUtxos
      var args = clone(sendArgs)
      addUtxos(args, softMaxWalletUtxos - 1)
      args.to[0].amount = 1020
      await test(args)
    })
    it('should work with 50 utxos', async function() {
      var args = clone(sendArgs)
      addUtxos(args, 50 - 1)
      args.to[0].amount = 1020
      await test(args)
    })
    it('should work with 500 utxos', async function() {
      var args = clone(sendArgs)
      addUtxos(args, 500 - 1)
      args.to[0].amount = 1020
      await test(args)
    })
  })

  it('change address could be a function', async function() {
    var args = clone(sendArgs)
    // @ts-ignore
    args.changeAddress = () => sendArgs.changeAddress
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + change
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    assert.equal(outputScriptToAddress(tx.outs[2].script), sendArgs.changeAddress, 'assets change')
  })
  it('bitcoin change address could be a function', async function() {
    var args = clone(sendArgs)
    var btcAddr = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
    args.bitcoinChangeAddress = () => btcAddr
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [0, 3])
    assert.equal(outputScriptToAddress(tx.outs[2].script), btcAddr, 'bitcoin change')
    assert.equal(outputScriptToAddress(tx.outs[3].script), sendArgs.changeAddress, 'assets change')
  })
  describe('feePerKb', async function() {
    it('works if the parameter feePerKb is used instead of fee', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      delete args.fee
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      var size = Math.round(result.txHex.length / 2)
      assert.equal(tx.ins.length, 1)
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach((input) => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function (output) { return output.value })
      var fee = sumValueInputs - sumValueOutputs
      var feePerKb = fee / (size / 1000)
      assert.equal(feePerKb, 777)
    })
    it('works with bitcoin dust inputs', async function() {
      // Here we'll test the edge case when a new utxo is needed to pay for fees,
      // and the new utxo increas the fee so another utxo is needed
      var args = clone(sendArgs)
      addUtxos(args, 2)
      // TODO: modify u.value in order to trigger the cycle
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      // TODO: some type of checks on result
    })
    it('raises an error on too low fees', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      delete args.fee
      args.feePerKb = 77
      await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /A meaningful request/)
    })
  })
})

var burnArgs = {
  utxos: [
    {
      txid: '9ad3154af0fba1c7ff399935f55680810faaf1e382f419fe1247e43edb12941d',
      index: 3,
      value: 9789000,
      used: false,
      blockheight: 577969,
      blocktime: 1444861908000,
      scriptPubKey: {
        asm: 'OP_DUP OP_HASH160 0e8fffc70907a025e65f0bdbc5ec6bb2d326d3a7 OP_EQUALVERIFY OP_CHECKSIG',
        hex: '76a9140e8fffc70907a025e65f0bdbc5ec6bb2d326d3a788ac',
        reqSigs: 1,
        type: 'pubkeyhash',
        addresses: ['mgqxFyV13aG2HQpnQ2bLKTUwm8wTPtssQ5']
      },
      assets: [
        {
          assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j',
          amount: 50,
          issueTxid: '3b598a4048557ab507952ee5705040ab1a184e54ed70f31e0e20b0be7549cd09',
          divisibility: 2,
          lockStatus: false,
          aggregationPolicy: 'aggregatable'
        }
      ]
    }
  ],
  burn: [{ amount: 20, assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j' }],
  changeAddress: 'mfuVBQVHpPGiVrAB6MoNaPjiiY1va7f4bc',
  fee: 5000
}

describe('the burn builder', function () {
  it('returns valid response with default values', async function () {
    var result = await ccb.buildBurnTransaction(burnArgs)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 2) // OP_RETURN + change
    assert.deepEqual(result.coloredOutputIndexes, [1])
    var sumValueInputs = sendArgs.utxos[0].value
    var sumValueOutputs = _.sumBy(tx.outs, function (output) { return output.value })
    assert.equal(sumValueInputs - sumValueOutputs, burnArgs.fee)
    var opReturnScriptBuffer = script.decompile(tx.outs[0].script)[1]
    var ccTransaction = CC.fromHex(opReturnScriptBuffer)
    assert.equal(ccTransaction.type, 'burn')
    assert.equal(ccTransaction.payments[0].burn, true)
    assert.equal(ccTransaction.payments[0].input, 0)
    assert.equal(ccTransaction.payments[0].amount, burnArgs.burn[0].amount)
  })
})

describe('the class constructor', function (){
  it('use custom minDustValue', async function () {

    var builder = new ColoredCoinsBuilder({
      network: 'testnet',
      minDustValue: 777,
    })

    var args = clone(sendArgs)
    args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
    var result = await builder.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [0, 3])
    assert.equal(tx.outs[0].value, 777, 'Satoshis to receiver')
    assert.equal(tx.outs[1].value, 0, 'Satoshis to the op return output')
    assert.equal(tx.outs[3].value, 777, 'Satoshis to the colored change output')
  })
})
