/* eslint-env mocha */
var softMaxWalletUtxos = 3
var ColoredCoinsBuilder = require('..')
var ccb = new ColoredCoinsBuilder({ network: 'testnet', softMaxUtxos: softMaxWalletUtxos, assetAddressHrp: 'sac' })
var regCcb = new ColoredCoinsBuilder({ network: 'regtest', softMaxUtxos: softMaxWalletUtxos, assetAddressHrp: 'sac' })

var assert = require('assert')
var clone = require('clone')
var bitcoinjs = require('bitcoinjs-lib')
var Transaction = bitcoinjs.Transaction
var script = bitcoinjs.script
var CC = require('cc-transaction')
var _ = require('lodash')

// redefinition of constants
const P2PKH_SCRIPTSIG_SIZE = 107
const P2PK_SIG_SIZE = 73

/* Tests utils */
function outputScriptToAddress(script) {
  return bitcoinjs.address.fromOutputScript(script, bitcoinjs.networks.testnet)
}

// assert helper: I don't know why we need this
async function assertThrowsAsync(fn, regExp) {
  let f = () => {}
  try {
    await fn()
  } catch (e) {
    f = () => {
      throw e
    }
  } finally {
    assert.throws(f, regExp)
  }
}

var issueArgs = {
  utxos: [
    {
      txid: 'b757c9f200c8ccd937ad493b2d499364640c0e2bfc62f99ef9aec635b7ff3474',
      index: 1,
      value: 598595600,
      scriptPubKey: {
        addresses: ['mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY'],
        hex: '76a91477c0232b1c5c77f90754c9a400b825547cc30ebd88ac'
      }
    }
  ],
  issueAddress: 'mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY',
  amount: 3600,
  fee: 5000
}

describe('the issue builder', function() {
  it('args must have utxos field', async function() {
    var args = clone(issueArgs)
    delete args.utxos
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "utxos"/)
  })

  it('args must have fee field', async function() {
    var args = clone(issueArgs)
    delete args.fee
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "fee"/)
  })

  it('args must have issueAddress field', async function() {
    var args = clone(issueArgs)
    delete args.issueAddress
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "issueAddress"/)
  })

  it('args must have amount field', async function() {
    var args = clone(issueArgs)
    delete args.amount
    await assertThrowsAsync(async () => await ccb.buildIssueTransaction(args), /Must have "amount"/)
  })

  it('returns valid response with default values', async function() {
    var result = await ccb.buildIssueTransaction(issueArgs)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // OP_RETURN + 2 changes
    assert(result.assetId)
    assert.deepEqual(result.coloredOutputIndexes, [2])
    var sumValueInputs = issueArgs.utxos[0].value
    var sumValueOutputs = _.sumBy(tx.outs, function(output) {
      return output.value
    })
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

  it('on injectPreviousOutput returns previous output hex in inputs', async function() {
    var args = clone(issueArgs)
    args.flags = { injectPreviousOutput: true }
    var result = await ccb.buildIssueTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.ins[0].script.toString('hex'), args.utxos[0].scriptPubKey.hex)
  })

  it('should split change', async function() {
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

const p2shSegwitScriptPubKey = {
  hex: 'a91407e8a3eaf30ffec25e0a2234783e2fd235d0250187',
  addresses: ['2Msy3QkwgBpqQVuYMxG8UYLa4bBawAyf6a2']
}

const p2wpkhScriptPubKey = {
  hex: '0014480f3f8a306f62cc0394de9cf0278fe191cd14bf',
  addresses: ['tb1qfq8nlz3sda3vcqu5m6w0qfu0uxgu699lteuw8p']
}

const p2pkScriptPubKey = {
  hex: '2102d0d196a577d46659660be9454c8599958f86e721853789a742dab16923438ac3ac',
  addresses: []
  // we do not have an address representation, but some implementations
  // encoded them as legacy addresses. This is a bug
}

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
  to: [
    { address: 'mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY', amount: 20, assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j' }
  ],
  changeAddress: 'mfuVBQVHpPGiVrAB6MoNaPjiiY1va7f4bc',
  fee: 5000
}

var sendRawModeArgs = {
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
    },
    {
      txid: '9ad3154af0fba1c7ff399935f55680810faaf1e382f419fe1247e43edb12941d',
      index: 1,
      value: 2000,
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
          amount: 100,
          issueTxid: '3b598a4048557ab507952ee5705040ab1a184e54ed70f31e0e20b0be7549cd09',
          divisibility: 2,
          lockStatus: false,
          aggregationPolicy: 'aggregatable'
        }
      ]
    },
    {
      txid: '9ad3154af0fba1c7ff399935f55680810faaf1e382f419fe1247e43edb12941d',
      index: 3,
      value: 33333,
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
      assets: []
    }
  ],
  to: [
    {
      address: 'mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY',
      amount: 20,
      assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j'
    },
    {
      address: '2MyjESMWRjAWm9wJqr4tnVf9kD9sb1YcM2D',
      amount: 10,
      amountBtc: 44000,
      assetId: 'Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j'
    }
  ],
  rawMode: true
}

describe('the send builder', function() {
  it('args must have utxos field', async function() {
    var args = clone(sendArgs)
    delete args.utxos
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "utxos"/)
  })

  it('args must have to field', async function() {
    var args = clone(sendArgs)
    delete args.to
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "to"/)
  })

  it('args must have fee field', async function() {
    var args = clone(sendArgs)
    delete args.fee
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "fee" or "feePerKb"/)
  })

  it('args must have fee field', async function() {
    var args = clone(sendArgs)
    args.feePerKb = 2200
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must not have "fee" and "feePerKb"/)
  })

  it('args must have changeAddress field', async function() {
    var args = clone(sendArgs)
    delete args.changeAddress
    await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /Must have "changeAddress"/)
  })

  it('returns valid response with default values', async function() {
    var args = clone(sendArgs)
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + change
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    var sumValueInputs = sendArgs.utxos[0].value
    var sumValueOutputs = _.sumBy(tx.outs, function(output) {
      return output.value
    })
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

  it('return a response with bech32 testnet addresses', async function() {
    var args = clone(sendArgs)
    const address = 'tb1qfq8nlz3sda3vcqu5m6w0qfu0uxgu699lteuw8p'
    args.to[0].address = address
    args.changeAddress = address
    args.utxos[0].scriptPubKey.addresses[0] = address
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
  })

  it('return a response with bech32 regtest addresses', async function() {
    var args = clone(sendArgs)
    const address = 'bcrt1q9apxm7m0xdf4g455fr66a773vg78sa0kdhd7nd'
    args.to[0].address = address
    args.changeAddress = address
    args.utxos[0].scriptPubKey.addresses[0] = address
    var result = await regCcb.buildSendTransaction(args)
    assert(result.txHex)
  })

  it('returns valid response with several outputs', async function() {
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

  it('on injectPreviousOutput returns previous output hex in inputs', async function() {
    var args = clone(sendArgs)
    args.flags = { injectPreviousOutput: true }
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.ins[0].script.toString('hex'), args.utxos[0].scriptPubKey.hex)
  })

  it('should not split change', async function() {
    var args = clone(sendArgs)
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + 1 change
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    assert.equal(outputScriptToAddress(tx.outs[2].script), sendArgs.changeAddress)
  })

  it('should split change', async function() {
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

  it('should accept placeholder changes addresses', async function() {
    var args = clone(sendArgs)
    args.changeAddress = 'placeholder'
    args.bitcoinChangeAddress = 'placeholder'
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [0, 3])
  })

  it('should have only asset change', async function() {
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

  it('should have only asset change because the btc change is too small', async function() {
    var args = clone(sendArgs)
    var btcAddr = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
    args.bitcoinChangeAddress = btcAddr
    // Spend all in fees
    args.fee = args.utxos[0].value - (2 * 600 + 100)
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + assets change
    assert.ok(tx.outs[2].value === 600 + 100, 'some satoshis are added to the asset change address')
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    assert.equal(outputScriptToAddress(tx.outs[2].script), sendArgs.changeAddress, 'assets change')
  })

  it('should have only bitcoin change', async function() {
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

  function addUtxos(args, n, bitcoinOnly) {
    for (var i = 1; i <= n; i++) {
      args.utxos.push(clone(args.utxos[0]))
      args.utxos[i].index = i
      if (bitcoinOnly) {
        args.utxos[i].assets = []
      }
    }
  }

  it('can select enough sats required by amountBtc', async function() {
    var args = clone(sendArgs)
    args.to[0].amountBtc = args.utxos[0].value * 10
    addUtxos(args, 10, true)
    var result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    Transaction.fromHex(result.txHex)
  })

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
      if (tx.ins.length < expectedNumberOfUtxos(args.utxos, softMaxWalletUtxos)) assert.fail()
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      var sumValueInputs = 0
      // The vout of inputs define the binded utxo, because vouts are unique
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
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
  it('works if there is no colored change but bitcoinChangeAddress is not defined', async function() {
    /* case:
     *  - no bitcoinChangeAddress provided
     *  - no asset change
     *  - bitcoin change
     * what we expect:
     *  - all the change into args.changeAddress
     */
    var args = clone(sendArgs)
    args.utxos[0].assets[0].amount = 1
    args.to[0].amount = 1
    // NO: args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'

    const result = await ccb.buildSendTransaction(args)

    const tx = Transaction.fromHex(result.txHex)
    assert.equal(outputScriptToAddress(tx.outs[2].script), args.changeAddress)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + btc change
    assert.deepEqual(result.coloredOutputIndexes, [0])
  })
  describe('feePerKb', async function() {
    function testFeePerKb(actual, expected) {
      // vKb, actual
      var msg = '. actual = ' + actual + ' e expected = ' + expected
      assert.ok(actual >= expected, 'feePerKb is too low' + msg)
      assert.ok(actual < expected * 1.02, 'feePerKb is too high' + msg)
    }

    it('works if the parameter feePerKb is used instead of fee', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      delete args.fee
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 1)
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      const unsignedSize = Math.round(result.txHex.length / 2)
      const signedSize = unsignedSize + tx.ins.length * P2PKH_SCRIPTSIG_SIZE
      var feePerKb = fee / (signedSize / 1000)
      testFeePerKb(feePerKb, 7777)
    })
    it('works with bitcoin dust inputs', async function() {
      // Here we'll test the edge case when a new utxo is needed to pay for fees,
      // and the new utxo increas the fee so another utxo is needed
      var args = clone(sendArgs)
      addUtxos(args, 2, true)
      args.utxos[0].value = 1788
      args.utxos[1].value = 2452
      args.utxos[2].value = 1152
      delete args.fee
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      var sumValueInputs = 0
      var tx = Transaction.fromHex(result.txHex)
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      assert.ok(fee >= 0, 'Fee is a natural number: ' + fee)
      const unsignedSize = Math.round(result.txHex.length / 2)
      const signedSize = unsignedSize + tx.ins.length * P2PKH_SCRIPTSIG_SIZE
      var feePerKb = fee / (signedSize / 1000)
      testFeePerKb(feePerKb, args.feePerKb)
    })
    it('fails creating tx due to fees', async function() {
      var args = clone(sendArgs)
      addUtxos(args, 2, true)
      // required input: 3379
      // provided: 1127+1126+1125 -> 3378
      args.utxos[0].value = 1127
      args.utxos[1].value = 1126
      args.utxos[2].value = 1125
      delete args.fee
      args.feePerKb = 10000
      await assertThrowsAsync(
        async () => await ccb.buildSendTransaction(args),
        /Not enough satoshi to cover transaction/
      )
    })
    it('raises an error on too low fees', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      delete args.fee
      args.feePerKb = 77
      await assertThrowsAsync(async () => await ccb.buildSendTransaction(args), /"feePerKb" is too low/)
    })
    it('works if there are wrapper segwit inputs', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      delete args.fee
      args.utxos[0].scriptPubKey = clone(p2shSegwitScriptPubKey)
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 1)
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      const weight = 42 + 364 + 3 * 136 + (36 + tx.outs[1].script.length * 4)
      // base Segwit + p2wpkh in p2sh input + 3 * p2pkh outputs + op_return output
      var feePerKb = fee / (weight / 4000)
      testFeePerKb(feePerKb, 7777)
    })
    it('works if there are native segwit inputs', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      delete args.fee
      args.utxos[0].scriptPubKey = clone(p2wpkhScriptPubKey)
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 1)
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      const weight = 42 + 271 + 3 * 136 + (36 + tx.outs[1].script.length * 4)
      // base Segwit + p2wpkh input + 3 * p2pkh outputs + op_return output
      var feePerKb = fee / (weight / 4000)
      testFeePerKb(feePerKb, 7777)
    })
    it('works if there are wrapper segwit outputs', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      args.to[0].address = '2N3HjV1s7DRKeX92upkHDzghdaw3SmPkRSc'
      delete args.fee
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 1)
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      const weight = 40 + 592 + 128 + 2 * 136 + (36 + tx.outs[1].script.length * 4)
      // base legacy + p2pkh input + p2sh output + 2 * p2pkh outputs + op_return output
      var feePerKb = fee / (weight / 4000)
      testFeePerKb(feePerKb, 7777)
    })
    it('works if there are native segwit outputs', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      args.to[0].address = 'tb1qugq5lep9qzxv3w70v26ez00n3cjn630fup4fr2'
      delete args.fee
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 1)
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      const weight = 40 + 592 + 124 + 2 * 136 + (36 + tx.outs[1].script.length * 4)
      // base legacy + p2pkh input + p2wpkh output + 2 * p2pkh outputs + op_return output
      var feePerKb = fee / (weight / 4000)
      testFeePerKb(feePerKb, 7777)
    })
    it('works if there are p2pk inputs', async function() {
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      delete args.fee
      args.utxos[0].scriptPubKey = clone(p2pkScriptPubKey)
      args.feePerKb = 7777
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 1)
      assert.equal(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
      assert.deepEqual(result.coloredOutputIndexes, [0, 3])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      const unsignedSize = Math.round(result.txHex.length / 2)
      const signedSize = unsignedSize + tx.ins.length * P2PK_SIG_SIZE
      var feePerKb = fee / (signedSize / 1000)
      testFeePerKb(feePerKb, 7777)
    })
    it('fee includes VarInt input counter', async function() {
      // VarInt counters are used to count inputs and outputs
      // use 300 inputs
      const N = 300
      var args = clone(sendArgs)
      args.bitcoinChangeAddress = 'mhj6b1H3BsFo4N32hMYoXMyx9UxTHw5VFK'
      args.utxos[0].assets[0].amount = 1
      args.to[0].amount = N
      addUtxos(args, N - 1)
      delete args.fee
      args.feePerKb = 1000
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, N)
      assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + bitcoin change
      assert.deepEqual(result.coloredOutputIndexes, [0])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      // prettier-ignore
      const expectedFee = (10 + (3 - 1)) + 148 * N + 2 * 34 + (9 + tx.outs[1].script.length)
      const fee = sumValueInputs - sumValueOutputs
      assert.equal(fee, expectedFee)
    })
    it('works if fees are decreased in the fee cycle', async function() {
      // The transaction is built to cause the deletion of the bitcoin change output
      // after the some rounds (maybe one) of the fee cycle.
      // So the fee selection algorithm must decrease the estimation of the fees
      var args = clone(sendArgs)
      args.changeAddress = 'tb1q4g5welug9xdz4rq6j9d20fshegh80000qce8qm'
      args.bitcoinChangeAddress = 'tb1qc603lcjl3yzj9wgaskzkvxuxe8k4acadg0lvdg'
      // the bitcoin change address won't be used
      delete args.fee
      args.utxos[0].assets[0].amount = 606666666
      args.utxos[0].value = 546
      args.utxos[0].scriptPubKey = clone(p2shSegwitScriptPubKey)

      // add a bitcoin input
      addUtxos(args, 1, true)
      args.utxos[1].value = 1272
      args.utxos[1].scriptPubKey = clone(p2wpkhScriptPubKey)

      args.to[0].address = '2NCWmUyf7Sq1rzBpbfqXZWocqUtZ8ZPxqjg'
      args.to[0].amount = 6666666

      args.feePerKb = 1000
      var result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 2)
      assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + colored change
      assert.deepEqual(result.coloredOutputIndexes, [0, 2])
      // Compute the fees, check if they are correct
      var sumValueInputs = 0
      tx.ins.forEach(input => {
        sumValueInputs += args.utxos[input.index].value
      })
      var sumValueOutputs = _.sumBy(tx.outs, function(output) {
        return output.value
      })
      var fee = sumValueInputs - sumValueOutputs
      const weight = 42 + (364 + 271) + (128 + 36 + tx.outs[1].script.length * 4 + 124)
      var feePerKb = fee / (weight / 4000)
      testFeePerKb(feePerKb, 1000)
    })
  })
  it('works with several inputs', async function() {
    var args = clone(sendArgs)
    var n = 1000
    args.utxos[0].assets[0].amount = 1
    addUtxos(args, n - 1, false)
    args.to[0].amount = n

    const result = await ccb.buildSendTransaction(args)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, n)
    assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + change
    assert.deepEqual(result.coloredOutputIndexes, [0])
  })
  describe('magic selector', async function() {
    const magicOutputSelector = 8212

    it('fails if the only finance utxo is magic', async function() {
      var args = clone(sendArgs)
      args.fee = 100000
      addUtxos(args, 1, true)
      args.utxos[0].value = magicOutputSelector
      args.utxos[1].value = magicOutputSelector * 15 // 123180
      await assertThrowsAsync(
        async () => await ccb.buildSendTransaction(args),
        /Not enough satoshi to cover transaction/
      )
    })
    it('works if the only finance utxo is magic and the asset utxo can pay enough', async function() {
      var args = clone(sendArgs)
      args.fee = 100000
      addUtxos(args, 1, true)
      args.utxos[0].value = magicOutputSelector * 15 // 123180
      args.utxos[1].value = magicOutputSelector * 15 // 123180
      const result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 1) // utxo with assets
      assert.equal(tx.outs.length, 3) // transfer + OP_RETURN + change
    })
    it('the transaction does not cointain magic inputs', async function() {
      var args = clone(sendArgs)
      args.fee = 100000
      addUtxos(args, 4, true)
      args.utxos[0].value = 600
      args.utxos[1].value = magicOutputSelector * 2 // magic: 16424
      args.utxos[2].value = magicOutputSelector * 3 + 1 // muggle: 24637
      args.utxos[3].value = magicOutputSelector * 15 // magic: 123180
      args.utxos[4].value = 77000 // muggle
      const result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 3) // utxo with assets, 2 muggle utxos
      const inputsIndexes = _.map(tx.ins, 'index')
      assert.deepEqual(inputsIndexes, [0, 2, 4])
    })
  })
  describe('uses amountBtc', async function() {
    it('to set the btc value', async function() {
      var args = clone(sendArgs)
      args.to[0].amountBtc = 7008
      const result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      var tx = Transaction.fromHex(result.txHex)

      assert.equal(tx.outs[0].value, 7008)
    })
    it('to compute the fees', async function() {
      // when feePerKb is used, fees won't change if the amountBtc value is different
      let args = clone(sendArgs)

      // compute the fees value with a standard amountBtc
      args.feePerKb = 1000
      delete args.fee
      // args.to[0].amountBtc = 7008
      let result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      let tx = Transaction.fromHex(result.txHex)

      assert.equal(tx.outs[1].value, 0, 'the value of OP_RETURN output is not 0')
      const standardFee = args.utxos[0].value - tx.outs[0].value - tx.outs[2].value

      // compute the fees value with a non standard amountBtc
      args = clone(sendArgs)
      args.feePerKb = 1000
      delete args.fee
      args.to[0].amountBtc = 7008
      result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      tx = Transaction.fromHex(result.txHex)

      assert.equal(tx.outs[1].value, 0, 'the value of OP_RETURN output is not 0')
      const fee = args.utxos[0].value - tx.outs[0].value - tx.outs[2].value

      assert.equal(fee, standardFee)
    })
  })

  describe('raw mode', async function() {
    it('does not accept fee parameter', async function() {
      var args = clone(sendRawModeArgs)
      args.fee = 5000
      await assertThrowsAsync(
        async () => await ccb.buildSendTransaction(args),
        /rawMode and fee are incompatible options/
      )
    })
    it('does not accept feePerKb parameter', async function() {
      var args = clone(sendRawModeArgs)
      args.feePerKb = 5000
      await assertThrowsAsync(
        async () => await ccb.buildSendTransaction(args),
        /rawMode and feePerKb are incompatible options/
      )
    })
    it('does not accept changeAddress parameter', async function() {
      var args = clone(sendRawModeArgs)
      args.changeAddress = 'n3uTa2Hfa8BVXfhFVu6MwchmjEGFBDgrMi'
      await assertThrowsAsync(
        async () => await ccb.buildSendTransaction(args),
        /rawMode and changeAddress are incompatible options/
      )
    })
    it('does not accept changeAddressBtc parameter', async function() {
      var args = clone(sendRawModeArgs)
      args.changeAddressBtc = 'n3uTa2Hfa8BVXfhFVu6MwchmjEGFBDgrMi'
      await assertThrowsAsync(
        async () => await ccb.buildSendTransaction(args),
        /rawMode and changeAddressBtc are incompatible options/
      )
    })
    it('uses all the inputs', async function() {
      // even if it is not needed
      var args = clone(sendRawModeArgs)
      const result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      const tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.ins.length, 3)
    })
    it('do not create change outputs', async function() {
      var args = clone(sendRawModeArgs)
      const result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      const tx = Transaction.fromHex(result.txHex)

      assert.equal(tx.outs.length, 2 + 1) // send outputs + op return
    })
    it('uses amountBtc values', async function() {
      var args = clone(sendRawModeArgs)
      const result = await ccb.buildSendTransaction(args)
      assert(result.txHex)
      const tx = Transaction.fromHex(result.txHex)
      assert.equal(tx.outs[1].value, args.to[1].amountBtc)
      assert.equal(tx.outs[2].value, 0)
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

describe('the burn builder', function() {
  it('returns valid response with default values', async function() {
    var result = await ccb.buildBurnTransaction(burnArgs)
    assert(result.txHex)
    var tx = Transaction.fromHex(result.txHex)
    assert.equal(tx.ins.length, 1)
    assert.equal(tx.outs.length, 2) // OP_RETURN + change
    assert.deepEqual(result.coloredOutputIndexes, [1])
    var sumValueInputs = sendArgs.utxos[0].value
    var sumValueOutputs = _.sumBy(tx.outs, function(output) {
      return output.value
    })
    assert.equal(sumValueInputs - sumValueOutputs, burnArgs.fee)
    var opReturnScriptBuffer = script.decompile(tx.outs[0].script)[1]
    var ccTransaction = CC.fromHex(opReturnScriptBuffer)
    assert.equal(ccTransaction.type, 'burn')
    assert.equal(ccTransaction.payments[0].burn, true)
    assert.equal(ccTransaction.payments[0].input, 0)
    assert.equal(ccTransaction.payments[0].amount, burnArgs.burn[0].amount)
  })
})

describe('the class constructor', function() {
  it('use custom minDustValue', async function() {
    var builder = new ColoredCoinsBuilder({
      network: 'testnet',
      minDustValue: 777
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

// generated with Python
// amounts = [round(random.random() * min(2**i, 111111111) * 1e7) for i in range(1, 31)]
// random.shuffle(amounts)
var amountsArgs = {
  amounts: [
    1162278744310,
    470438413824872,
    865334940269007,
    26635831638,
    562851061,
    19216108,
    6783960103909,
    54305474586,
    279194260679,
    47711531393351,
    70280214257,
    10539861143,
    16705204,
    265469170,
    2256791934,
    6621892482630,
    39317958,
    55558594,
    33185237573346,
    857079239674824,
    60444333717,
    1465772646720,
    2446891095303,
    233500202,
    41251757825687,
    247385184,
    8581193644,
    31464035471091,
    753539955007961,
    149197981660432
  ]
}

describe('opReturnLimit', async function() {
  it('requires amounts', async function() {
    await assertThrowsAsync(async () => await ccb.opReturnLimit({}), /Must have "amounts"/)
  })
  it('works with 0 amounts', async function() {
    const args = { amounts: [] }
    const n = await ccb.opReturnLimit(args)
    assert.equal(n, 0)
  })
  it('it is consistent with its own results', async function() {
    var maxN = -1
    const amounts = amountsArgs.amounts
    for (var i = 0; i < amounts.length; i++) {
      const args = { amounts: amounts.slice(0, i) }
      const n = await ccb.opReturnLimit(args)
      assert(n >= maxN)
      maxN = n
    }
  })
  it('works with smallest amounts', async function() {
    var amounts = []
    for (var i = 0; i < 100; i++) {
      amounts.push(1)
    }
    const args = { amounts: amounts }
    const n = await ccb.opReturnLimit(args)
    assert(n > 0)
  })
  it('works with big amounts', async function() {
    var amounts = []
    for (var i = 0; i < 100; i++) {
      amounts.push(1111111111111111)
    }
    const args = { amounts: amounts }
    const n = await ccb.opReturnLimit(args)
    assert(n > 0)
  })
})

describe('addresses', function() {
  describe('conversion', function() {
    it('converts valid bitcoin address to asset address', async function() {
      const bitcoin = 'tb1qslqmsaue588j8v5dkazq2cu548dzxg7raz587p'
      const asset = ccb.toAssetBech32Address(bitcoin)
      assert.equal(asset, 'tsac1qslqmsaue588j8v5dkazq2cu548dzxg7rsy5c89')
    })
    it('raises error on invalid bitcoin address', async function() {
      const bitcoin = 'inv1qslqmsaue588j8v5dkazq2cu548dzxg7raz587p'
      await assertThrowsAsync(async () => await ccb.toAssetBech32Address(bitcoin), /Invalid bitcoin address/)
    })
    it('converts valid asset address to bitcoin address', async function() {
      const asset = 'tsac1qslqmsaue588j8v5dkazq2cu548dzxg7rsy5c89'
      const bitcoin = ccb.toBitcoinBech32Address(asset)
      assert.equal(bitcoin, 'tb1qslqmsaue588j8v5dkazq2cu548dzxg7raz587p')
    })
    it('raises error on invalid asset address', async function() {
      const asset = 'sac1qslqmsaue588j8v5dkazq2cu548dzxg7raz587p'
      await assertThrowsAsync(async () => await ccb.toBitcoinBech32Address(asset), /Invalid asset address/)
    })
    describe('on regtest', function() {
      it('converts valid bitcoin address to asset address', async function() {
        const bitcoin = 'bcrt1q9apxm7m0xdf4g455fr66a773vg78sa0kdhd7nd'
        const asset = regCcb.toAssetBech32Address(bitcoin)
        assert.equal(asset, 'tsac1q9apxm7m0xdf4g455fr66a773vg78sa0kzc5vaq')
      })
      it('converts valid asset address to bitcoin address', async function() {
        const asset = 'tsac1q9apxm7m0xdf4g455fr66a773vg78sa0kzc5vaq'
        const bitcoin = regCcb.toBitcoinBech32Address(asset)
        assert.equal(bitcoin, 'bcrt1q9apxm7m0xdf4g455fr66a773vg78sa0kdhd7nd')
      })
    })
  })
  describe('validity', function() {
    describe('asset', function() {
      it('success', function() {
        const address = 'tsac1qslqmsaue588j8v5dkazq2cu548dzxg7rsy5c89'
        assert(ccb.isValidAssetBech32Address(address))
      })
      it('error', function() {
        const address = 'tsac1qslqmsaue588j8v5dkazq2cu548dzxg7rsy5XXX'
        assert(!ccb.isValidAssetBech32Address(address))
      })
    })
    describe('bitcoin', function() {
      describe('testnet', function() {
        it('success', function() {
          const address = 'tb1qfq8nlz3sda3vcqu5m6w0qfu0uxgu699lteuw8p'
          assert(ccb.isValidBitcoinBech32Address(address))
        })
        it('error', function() {
          const address = 'tb1qfq8nlz3sda3vcqu5m6w0qfu0uxgu699lteuXXX'
          assert(!ccb.isValidBitcoinBech32Address(address))
        })
      })
      describe('regtest', function() {
        it('success', function() {
          const address = 'bcrt1q9apxm7m0xdf4g455fr66a773vg78sa0kdhd7nd'
          assert(regCcb.isValidBitcoinBech32Address(address))
        })
        it('error', function() {
          const address = 'bcrt1q9apxm7m0xdf4g455fr66a773vg78sa0kdhdXXX'
          assert(!regCcb.isValidBitcoinBech32Address(address))
        })
      })
    })
  })
})
