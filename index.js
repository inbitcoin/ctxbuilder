var bitcoinjs = require('bitcoinjs-lib')
var BigNumber = require('bignumber.js')
var _ = require('lodash')
var encodeAssetId = require('cc-assetid-encoder')
var cc = require('cc-transaction')
var findBestMatchByNeededAssets = require('./modules/findBestMatchByNeededAssets')
var Buffer = require('safe-buffer').Buffer
var debug = require('debug')('cc-transaction-builder')
var errors = require('@inbitcoin/cerrors')
var bufferReverse = require('buffer-reverse')
var bech32 = require('bech32')

const magicOutputSelector = 8212
const CC_TX_VERSION = 0x02

const TX_WEIGHT = {
  p2pkh: {
    input: 592,
    output: 136,
  },
  p2wpkh: {
    input: 271,
    output: 124,
  },
  p2wpkhInP2sh: {
    input: 364, // (36+1+23+4)*4+1+1+72+1+33
  },
  p2sh: {
    output: 128,
  },
  p2pk: {
    input: 456,
  },
  baseTx: {
    legacy: 40,
    segwit: 42,
  },
  baseOutput: 36,  // weight of an output without its scriptPubKey
}

var ColoredCoinsBuilder = function(properties) {
  properties = properties || {}

  if (
    typeof properties.network !== 'undefined' &&
    properties.network !== 'testnet' &&
    properties.network !== 'regtest' &&
    properties.network !== 'mainnet'
  ) {
    throw new Error('"network" must be either "mainnet", "testnet" or "regtest"')
  }
  if (properties.mindustvaluemultisig) {
    throw new Error('Some properties are not supported anymore')
  }
  this.network = properties.network || 'mainnet' // 'testnet' or 'mainnet'

  this.minDustValue = parseInt(properties.minDustValue) || 600

  this.softMaxUtxos = parseInt(properties.softMaxUtxos) || 666

  this.assetAddressHrp = properties.assetAddressHrp
}

function checkNotSupportedArgs(args, builder) {
  function error() {
    throw new Error('Some args are not supported anymore')
  }
  if (
    args.torrentHash ||
    args.sha2 ||
    args.metadata ||
    args.rules ||
    args.from ||
    (args.to && args.to.pubKeys && args.to.m) ||
    args.defaultFee
  ) {
    error()
  }
  if (builder === 'send') {
    if (args.financeChangeAddress || args.financeOutput) {
      error()
    }
  }
}

/**
 * Compute the minumum number of inputs for the next transaction,
 * in order to limit the neverending growth of the utxo set
 */
ColoredCoinsBuilder.prototype.getMinInputs = function(utxos) {
  var self = this

  if (utxos.length <= self.softMaxUtxos) {
    return 0
  } else {
    return Math.floor(Math.log2(utxos.length - self.softMaxUtxos))
  }
}

ColoredCoinsBuilder.prototype.outputScriptToAddress = function(script) {
  var self = this

  var network
  if (self.network == 'mainnet') {
    network = bitcoinjs.networks.bitcoin
  } else {
    network = bitcoinjs.networks.testnet
  }
  return bitcoinjs.address.fromOutputScript(script, network)
}

ColoredCoinsBuilder.prototype.getPlaceholderAddress = function(version) {
  var self = this

  var hexScript
  if (version === 1) {
    hexScript = '76a914010000000000000000000000000000000000000088ac'
  } else if (version === 2) {
    hexScript = '76a914020000000000000000000000000000000000000088ac'
  } else {
    throw new Error('version unsupported')
  }
  const bufferScript = Buffer.from(hexScript, 'hex')
  return self.outputScriptToAddress(bufferScript)
}

ColoredCoinsBuilder.prototype.buildIssueTransaction = async function(args) {
  var self = this
  if (!args.utxos) {
    throw new Error('Must have "utxos"')
  }
  if (!args.fee) {
    throw new Error('Must have "fee"')
  }
  if (!args.issueAddress) {
    throw new Error('Must have "issueAddress"')
  }
  if (!args.amount) {
    throw new Error('Must have "amount"')
  }
  checkNotSupportedArgs(args)

  if (args.fee) {
    args.fee = parseInt(args.fee)
  }

  args.divisibility = args.divisibility || 0
  args.aggregationPolicy = args.aggregationPolicy || 'aggregatable'

  let networkObj
  if (self.network === 'testnet') {
    networkObj = bitcoinjs.networks.testnet
  } else if (self.network === 'regtest') {
    networkObj = _.clone(bitcoinjs.networks.testnet)
    networkObj.bech32 = 'bcrt'
  } else {
    networkObj = bitcoinjs.networks.bitcoin
  }
  var txb = new bitcoinjs.TransactionBuilder(networkObj)

  // find inputs to cover the issuance
  var ccArgs = self._addInputsForIssueTransaction(txb, args)
  if (!ccArgs.success) {
    throw new errors.NotEnoughFundsError({ type: 'issue' })
  }
  _.assign(ccArgs, args)
  var res = self._encodeColorScheme(ccArgs)
  res.assetId = ccArgs.assetId
  return res
}

ColoredCoinsBuilder.prototype._addInputsForIssueTransaction = function(txb, args) {
  var self = this
  var utxos = args.utxos
  var assetId = ''
  var current
  var cost

  // add to transaction enough inputs so we can cover the cost
  // send change if any back to us
  current = new BigNumber(0)
  cost = new BigNumber(self._getIssuanceCost(args))
  var change = new BigNumber(0)
  var hasEnoughEquity = utxos.some(function(utxo) {
    if (!isInputInTx(txb.tx, utxo.txid, utxo.index) && !(utxo.assets && utxo.assets.length)) {
      debug('1. current amount ' + utxo.value + ' needed ' + cost)
      debug('utxo.txid', utxo.txid)
      debug('utxo.index', utxo.index)
      txb.addInput(utxo.txid, utxo.index)
      if (txb.tx.ins.length === 1) {
        // encode asset
        debug(txb.tx.ins[0].script)
        assetId = self._encodeAssetId(
          args.reissueable,
          utxo.txid,
          utxo.index,
          utxo.scriptPubKey.hex,
          args.divisibility,
          args.aggregationPolicy
        )
      }
      debug('math: ' + current.toNumber() + ' ' + utxo.value)
      current = current.plus(utxo.value)
      if (args.flags && args.flags.injectPreviousOutput) {
        var chunks = bitcoinjs.script.decompile(new Buffer(utxo.scriptPubKey.hex, 'hex'))
        txb.tx.ins[txb.tx.ins.length - 1].script = bitcoinjs.script.compile(chunks)
      }
      debug(
        'current amount ' +
          current +
          ' projected cost: ' +
          cost +
          ' are were there yet: ' +
          (current.comparedTo(cost) >= 0)
      )
    } else {
      debug('skipping utxo for input, asset found in utxo: ' + utxo.txid + ':' + utxo.index)
    }
    return current.comparedTo(cost) >= 0
  })
  debug('hasEnoughEquity: ' + hasEnoughEquity)
  if (!hasEnoughEquity) {
    return { success: false }
  }

  change = current - cost
  debug('finished adding inputs to tx')
  debug('change ' + change)
  return { success: true, txb: txb, change: change, assetId: assetId, totalInputs: { amount: current } }
}

ColoredCoinsBuilder.prototype._getIssuanceCost = function(args) {
  var self = this
  var fee = args.fee
  var totalCost = fee
  debug('_getTotalIssuenceCost: fee =', fee)
  if (args.transfer && args.transfer.length) {
    args.transfer.forEach(function(to) {
      totalCost += self.minDustValue
    })
  }
  // change
  totalCost += self.minDustValue

  debug('_getTotalIssuenceCost: totalCost =', totalCost)
  return totalCost
}

ColoredCoinsBuilder.prototype._encodeAssetId = function(
  reissueable,
  txid,
  nvout,
  hex,
  divisibility,
  aggregationPolicy
) {
  var opts = {
    ccdata: [
      {
        type: 'issuance',
        lockStatus: !reissueable,
        divisibility: divisibility,
        aggregationPolicy: aggregationPolicy
      }
    ],
    vin: [
      {
        txid: txid,
        vout: nvout,
        previousOutput: {
          hex: hex
        }
      }
    ]
  }

  if (!reissueable) {
    debug('sending assetIdEncoder locked, first input = ' + txid + ':' + nvout)
  } else {
    debug('sending assetIdEncoder unlocked, first input previousOutput = ', opts.vin[0].previousOutput)
  }

  debug('encoding asset is locked: ' + !reissueable)
  debug(opts)
  var assetId = encodeAssetId(opts)
  debug('assetId: ' + assetId)
  return assetId
}

/**
 * This method is called only by build issue
 */
ColoredCoinsBuilder.prototype._encodeColorScheme = function(args) {
  var self = this
  var addMultisig = false
  var encoder = cc.newTransaction(0x4343, CC_TX_VERSION)
  var reedemScripts = []
  var coloredOutputIndexes = []
  var txb = args.txb
  var coloredAmount = args.amount
  var fee = args.fee
  var lockStatus
  if (typeof args.lockStatus !== 'undefined') {
    lockStatus = args.lockStatus
  } else if (typeof args.reissueable !== 'undefined') {
    lockStatus = !args.reissueable
  } else if (typeof args.reissuable !== 'undefined') {
    lockStatus = !args.reissuable
  }
  if (typeof lockStatus === 'undefined') {
    // default
    lockStatus = true
  }
  encoder.setLockStatus(lockStatus)
  encoder.setAmount(args.amount, args.divisibility)
  encoder.setAggregationPolicy(args.aggregationPolicy)

  if (args.transfer) {
    args.transfer.forEach(function(transferobj, i) {
      debug('payment ' + transferobj.amount + ' ' + txb.tx.outs.length)
      encoder.addPayment(0, transferobj.amount, txb.tx.outs.length)
      coloredAmount -= transferobj.amount
      // check multisig
      if (transferobj.pubKeys && transferobj.m) {
        var multisig = self._generateMultisigAddress(transferobj.pubKeys, transferobj.m)
        reedemScripts.push({
          index: txb.tx.outs.length,
          reedemScript: multisig.reedemScript,
          address: multisig.address
        })
        txb.addOutput(multisig.address, self.minDustValue)
      } else {
        txb.addOutput(transferobj.address, self.minDustValue)
      }
    })
  }

  if (coloredAmount < 0) {
    throw new errors.CCTransactionConstructionError({ explanation: 'transferring more than issued' })
  }

  // add OP_RETURN
  debug('before encode done')
  var buffer = encoder.encode()

  debug('encoding done, buffer: ', buffer)
  if (buffer.leftover && buffer.leftover.length > 0) {
    // We don't expect to enter here
    debug('Unsupported feature')
    throw new errors.CCTransactionConstructionError()
  }
  var ret = bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, buffer.codeBuffer])

  txb.addOutput(ret, 0)

  // add array of colored ouput indexes
  encoder.payments.forEach(function(payment) {
    coloredOutputIndexes.push(payment.output)
  })

  // add change
  var allOutputValues = _.sumBy(txb.tx.outs, function(output) {
    return output.value
  })
  debug('all inputs: ' + args.totalInputs.amount + ' all outputs: ' + allOutputValues)
  var lastOutputValue = args.totalInputs.amount - (allOutputValues + fee)
  if (lastOutputValue < self.minDustValue) {
    var totalCost = self.minDustValue + args.totalInputs.amount.toNumber()
    throw new errors.NotEnoughFundsError({
      type: 'issuance',
      fee: fee,
      totalCost: totalCost,
      missing: self.minDustValue - lastOutputValue
    })
  }

  var splitChange = !(args.financeChangeAddress == false)
  var changeAddress = args.financeChangeAddress || args.issueAddress

  if (splitChange && lastOutputValue >= 2 * self.minDustValue && coloredAmount > 0) {
    var bitcoinChange = lastOutputValue - self.minDustValue
    lastOutputValue = self.minDustValue
    debug('adding bitcoin change output with: ' + bitcoinChange)
    txb.addOutput(changeAddress, bitcoinChange)
  }

  if (coloredAmount > 0) {
    // there's a colored change output
    coloredOutputIndexes.push(txb.tx.outs.length)
  }

  debug('adding change output with: ' + lastOutputValue)
  debug('total inputs: ' + args.totalInputs.amount)
  debug('total fee: ' + fee)
  debug('total output without fee: ' + allOutputValues)
  txb.addOutput(args.issueAddress, lastOutputValue || args.change)
  debug('txHex ', txb.tx.toHex())

  return { txHex: txb.tx.toHex(), coloredOutputIndexes: _.uniq(coloredOutputIndexes) }
}

ColoredCoinsBuilder.prototype._generateMultisigAddress = function(pubKeys, m) {
  var self = this
  var ecpubkeys = []
  pubKeys.forEach(function(key) {
    ecpubkeys.push(bitcoinjs.ECPubKey.fromHex(key))
  })
  var script = bitcoinjs.scripts.multisigOutput(m, ecpubkeys)
  var hash = bitcoinjs.crypto.hash160(script)
  var multisigAdress = new bitcoinjs.Address(hash, self.network === 'testnet' ? 0xc4 : 0x05)
  var sendto = multisigAdress.toBase58Check()
  return { address: sendto, reedemScript: script.toHex() }
}

function isInputInTx(tx, txid, index) {
  return tx.ins.some(function(input) {
    var id = bufferReverse(input.hash)
    return id.toString('hex') === txid && input.index === index
  })
}

/**
 * Add all the utxos until they are not enough
 * Magic outputs are not selected
 * Fields updated by the function:
 * - inputsValue
 * - metadata
 * - txb.tx
 */
ColoredCoinsBuilder.prototype._insertSatoshiToTransaction = function(utxos, txb, missing, inputsValue, metadata) {
  debug('missing: ' + missing)
  var paymentDone = false
  var missingbn = new BigNumber(missing)
  var financeValue = new BigNumber(0)
  var currentAmount = new BigNumber(0)

  function isMagicValue(value) {
    return value % magicOutputSelector === 0
  }

  // Add all the utxos until they are not enough
  var hasEnoughEquity = utxos.some(function(utxo) {
    utxo.value = Math.round(utxo.value)
    // not an input yet && no assets && no magic value
    const isInput = isInputInTx(txb.tx, utxo.txid, utxo.index)
    const hasAssets = utxo.assets && utxo.assets.length
    const isMagic = isMagicValue(utxo.value)
    if (!isInput && !hasAssets && !isMagic) {
      debug('2. current amount ' + utxo.value + ' needed ' + missing)
      debug('add input: ' + utxo.txid + ':' + utxo.index)
      txb.addInput(utxo.txid, utxo.index)
      inputsValue.amount += utxo.value
      currentAmount = currentAmount.plus(utxo.value)
      if (metadata.flags && metadata.flags.injectPreviousOutput) {
        var chunks = bitcoinjs.script.decompile(new Buffer(utxo.scriptPubKey.hex, 'hex'))
        txb.tx.ins[txb.tx.ins.length - 1].script = bitcoinjs.script.compile(chunks)
      }
    }
    return currentAmount.comparedTo(missingbn) >= 0
  })
  debug('hasEnoughEquity: ' + hasEnoughEquity + ' missiyesg: ' + missing)

  return hasEnoughEquity
}

ColoredCoinsBuilder.prototype._tryAddingInputsForFee = function(txb, utxos, totalInputs, metadata, satoshiCost) {
  var self = this
  debug('tryAddingInputsForFee: current transaction value: ' + totalInputs.amount + ' projected cost: ' + satoshiCost)
  if (satoshiCost > totalInputs.amount) {
    if (!self._insertSatoshiToTransaction(utxos, txb, satoshiCost - totalInputs.amount, totalInputs, metadata)) {
      debug('not enough satoshi in account for fees')
      return false
    }
  } else {
    debug('No need for additional finance. cost: ' + satoshiCost + ' input: ' + totalInputs.amount)
  }
  return true
}

ColoredCoinsBuilder.prototype.buildSendTransaction = async function(args) {
  var self = this
  if (!args.utxos) {
    throw new Error('Must have "utxos"')
  }
  if (!args.to) {
    throw new Error('Must have "to"')
  }
  if (args.rawMode) {
    if (args.fee)
      throw new Error('rawMode and fee are incompatible options')
    if (args.feePerKb)
      throw new Error('rawMode and feePerKb are incompatible options')
    if (args.changeAddress)
      throw new Error('rawMode and changeAddress are incompatible options')
    if (args.changeAddressBtc)
      throw new Error('rawMode and changeAddressBtc are incompatible options')
  } else {
    if (!args.changeAddress) {
      throw new Error('Must have "changeAddress"')
    }
    if (!args.fee && !args.feePerKb) {
      throw new Error('Must have "fee" or "feePerKb"')
    }
    if (args.fee && args.feePerKb) {
      throw new Error('Must not have "fee" and "feePerKb"')
    }
    if (args.feePerKb && args.feePerKb < 1000) {
      throw new Error('"feePerKb" is too low')
    }
    if (args.changeAddress === '' || args.bitcoinChangeAddress === '') {
      throw new Error('"changeAddress and bitcoinChangeAddress must not be an empty string')
    }
  }
  checkNotSupportedArgs(args, 'send')

  if (args.fee) {
    args.fee = parseInt(args.fee)
  }

  let networkObj
  if (self.network === 'testnet') {
    networkObj = bitcoinjs.networks.testnet
  } else if (self.network === 'regtest') {
    networkObj = _.clone(bitcoinjs.networks.testnet)
    networkObj.bech32 = 'bcrt'
  } else {
    networkObj = bitcoinjs.networks.bitcoin
  }
  var txb = new bitcoinjs.TransactionBuilder(networkObj)

  if (args.rawMode)
    return self._buildRawModeSendTransaction(txb, args)
  else
    return self._addInputsForSendTransaction(txb, args)
}

ColoredCoinsBuilder.prototype._computeCost = function(withfee, args) {
  var self = this
  var cost = withfee ? args.fee : 0

  if (args.to) {
    args.to.forEach(function (output) {
      cost += output.amountBtc || self.minDustValue
    })
  }

  // count an asset change, the bitcoin change is not mandatory
  cost += self.minDustValue

  debug('comupteCost: ' + cost + ' outs.len = ' + args.to.length)
  return cost
}

/** 1 minDustFee for each output + fee
 */
ColoredCoinsBuilder.prototype._getInputAmountNeededForTx = function(tx, fee) {
  var self = this
  var total = fee
  tx.outs.forEach(function(output) {
    total += self.minDustValue
  })
  return total
}

ColoredCoinsBuilder.prototype._getChangeAmount = function(tx, fee, totalInputValue) {
  var allOutputValues = _.sumBy(tx.outs, function(output) {
    return output.value
  })
  debug('getChangeAmount: all inputs: ' + totalInputValue.amount + ' all outputs: ' + allOutputValues)
  return totalInputValue.amount - (allOutputValues + fee)
}

ColoredCoinsBuilder.prototype._addInputsForSendTransaction = async function(txb, args) {
  var self = this
  var totalInputs = { amount: 0 }
  var reedemScripts = []
  var coloredOutputIndexes = []

  debug('addInputsForSendTransaction')

  debug('got unspents from parmameter: ')
  debug(args.utxos)
  if (
    args.utxos[0] &&
    args.utxos[0].scriptPubKey &&
    args.utxos[0].scriptPubKey.addresses &&
    args.utxos[0].scriptPubKey.addresses[0]
  ) {
    args.from = args.utxos[0].scriptPubKey.addresses[0]
  }
  var assetList = {}
  args.to.forEach(function(to) {
    debug(to.assetId)
    if (!assetList[to.assetId]) {
      assetList[to.assetId] = { amount: 0, addresses: [], done: false, change: 0, encodeAmount: 0, inputs: [] }
    }
    assetList[to.assetId].amount += to.amount
    const amountBtc = to.amountBtc || self.minDustValue
    if (to.burn) {
      assetList[to.assetId].addresses.push({ address: 'burn', amount: to.amount, amountBtc: amountBtc })
    } else {
      assetList[to.assetId].addresses.push({ address: to.address, amount: to.amount, amountBtc: amountBtc })
    }
  })

  debug('finished creating per asset list')
  for (var asset in assetList) {
    debug('working on asset: ' + asset)
    debug(args.utxos)
    var assetUtxos = args.utxos.filter(function(element, index, array) {
      if (!element.assets) {
        return false
      }
      return element.assets.some(function(a) {
        debug('checking ' + a.assetId + ' and ' + asset)
        return a.assetId === asset
      })
    })
    if (assetUtxos && assetUtxos.length > 0) {
      debug('have utxo list')
      var key = asset
      assetUtxos.forEach(function(utxo) {
        if (utxo.used) {
          debug('utxo', utxo)
          throw new Error('Output ' + utxo.txid + ':' + utxo.index + ' is already spent!')
        }
      })
      debug('set the minimum number of inputs of asset ' + key)
      args.minInputs = self.getMinInputs(assetUtxos)
      if (!findBestMatchByNeededAssets(assetUtxos, assetList, key, txb, totalInputs, args)) {
        throw new Error('Not enough units of asset ' + key + ' to cover transfer transaction')
      }
    } else {
      debug('no utxo list')
      throw new Error('No output with the requested asset: ' + asset)
    }
  }
  debug('reached encoder')
  var encoder = cc.newTransaction(0x4343, CC_TX_VERSION)

  for (asset in assetList) {
    var currentAsset = assetList[asset]
    debug('encoding asset ' + asset)
    if (!currentAsset.done) {
      debug('current asset state is bad ' + asset)
      throw new errors.NotEnoughAssetsError({ asset: asset })
    }

    debug(currentAsset.addresses)
    var uniqAssets = _.uniqBy(currentAsset.addresses, function(item) {
      return item.address
    })
    debug('uniqAssets = ', uniqAssets)
    uniqAssets.forEach(function(address) {
      debug(
        'adding output ' +
          (txb.tx.outs ? txb.tx.outs.length : 0) +
          ' for address: ' +
          address.address +
          ' with satoshi value ' +
          self.minDustValue +
          ' asset value: ' +
          address.amount
      )
      var addressAmountLeft = address.amount
      debug('currentAsset = ', currentAsset, ', currentAsset.inputs.length = ', currentAsset.inputs.length)
      currentAsset.inputs.some(function(input) {
        if (!input.amount) {
          return false
        }
        if (addressAmountLeft - input.amount > 0) {
          debug('mapping to input ' + input.index + ' with amount ' + input.amount)
          if (address.address === 'burn') {
            encoder.addBurn(input.index, input.amount)
          } else {
            encoder.addPayment(input.index, input.amount, txb.tx.outs ? txb.tx.outs.length : 0)
          }
          addressAmountLeft -= input.amount
          debug('left to map from next input ' + addressAmountLeft)
          input.amount = 0
          return false
        } else {
          debug('mapping to input ' + input.index + ' with amount ' + addressAmountLeft)
          if (address.address === 'burn') {
            encoder.addBurn(input.index, addressAmountLeft)
          } else {
            encoder.addPayment(input.index, addressAmountLeft, txb.tx.outs ? txb.tx.outs.length : 0)
          }
          input.amount -= addressAmountLeft
          addressAmountLeft = 0
          return true
        }
      })
      debug('putting output in transaction')
      if (address.address !== 'burn') {
        txb.addOutput(address.address, address.amountBtc)
      }
      if (address.reedemScript) {
        reedemScripts.push({
          index: txb.tx.outs.length - 1,
          reedemScript: address.reedemScript,
          address: address.address
        })
      }
      debug('adding output ' + (txb.tx.outs.length - 1))
    })
    debug('done adding colored outputs')
  }
  debug('before using encoder')
  var buffer = encoder.encode()
  if (buffer.leftover && buffer.leftover.length > 0) {
    // We don't expect to enter here
    debug('Unsupported feature')
    throw new errors.CCTransactionConstructionError()
  }

  // add array of colored ouput indexes
  encoder.payments.forEach(function(payment) {
    if (typeof payment.output !== 'undefined') coloredOutputIndexes.push(payment.output)
  })

  debug('encoding done')
  var ret = bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, buffer.codeBuffer])
  txb.addOutput(ret, 0)

  // Fees cycle
  if (args.feePerKb && !args.fee) {
    // Iteratively discover the fee
    // Start from 1: it is like 0, but Boolean(1) is true
    args.fee = 100
    debug('Init args.fee = 100')
  } else {
    debug(`Fee setting: fee ${args.fee}, feePerKb ${args.feePerKb}`)
  }
  // baseInput: satoshis provided by the assets utxos
  var baseInput = totalInputs.amount
  while (true) {
    debug('Begin of fee cycle')
    var builder = _.cloneDeep(txb)
    builder.tx = _.cloneDeep(txb.tx) // Because deep is not so deep
    totalInputs.amount = baseInput
    // _computeCost use args.fee as parameter
    var satoshiCost = self._computeCost(true, args)
    debug('New satoshiCost (fee + mandaroty output) = ' + satoshiCost)
    debug('fee = ' + args.fee)
    debug('assets only: tx.ins.length = ' + builder.tx.ins.length)
    if (!self._tryAddingInputsForFee(builder, args.utxos, totalInputs, args, satoshiCost)) {
      throw new errors.NotEnoughFundsError({
        type: 'transfer',
        fee: args.fee,
        totalCost: satoshiCost,
        missing: satoshiCost - totalInputs.amount
      })
    }
    debug('added fees: tx.ins.length = ' + builder.tx.ins.length)

    var lastOutputValue = self._getChangeAmount(builder.tx, args.fee, totalInputs)
    var coloredChange = _.keys(assetList).some(function(assetId) {
      return assetList[assetId].change > 0
    })

    var splitChange = Boolean(args.bitcoinChangeAddress)
    var numOfChanges = splitChange && coloredChange && lastOutputValue >= 2 * self.minDustValue ? 2 : 1

    debug('lastOutputValue = ' + lastOutputValue)
    if (lastOutputValue < numOfChanges * self.minDustValue) {
      debug('trying to add additionl inputs to cover transaction')
      debug('Outs len = ' + builder.tx.outs.length)
      satoshiCost = args.fee + (builder.tx.outs.length - 1 + numOfChanges) * self.minDustValue
      if (!self._tryAddingInputsForFee(builder, args.utxos, totalInputs, args, satoshiCost)) {
        throw new errors.NotEnoughFundsError({
          type: 'transfer',
          fee: args.fee,
          totalCost: satoshiCost,
          missing: numOfChanges * self.minDustValue - lastOutputValue
        })
      }
      lastOutputValue = self._getChangeAmount(builder.tx, args.fee, totalInputs)
    }

    var btcChangeValue = lastOutputValue
    if (numOfChanges === 2) {
      btcChangeValue = lastOutputValue - self.minDustValue
      lastOutputValue = self.minDustValue
    }

    async function resolveAddress(object, placeholderId) {
      if (typeof object === 'function') {
        return object()
      }
      if (object === 'placeholder') {
        return self.getPlaceholderAddress(placeholderId)
      }
      return object
    }

    function b2a_hash(hash) {
      return hash
        .toString('hex')
        .match(/.{2}/g)
        .reverse()
        .join('')
    }

    // scripts are not reversed, buffers memorizes them from the first byte
    function b2a_script(hash) {
      if (!hash) return ''
      return hash
        .toString('hex')
        .match(/.{2}/g)
        .join('')
    }

    function _getInputWeightFromScriptPubKey(scriptPubKey) {
      // P2PKH
      // 76a9140e8fffc70907a025e65f0bdbc5ec6bb2d326d3a788ac
      // 76a914xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx88ac
      if (Boolean(scriptPubKey.match(/^76a914[a-f0-9]{40}88ac$/))) {
        return TX_WEIGHT.p2pkh.input
      }
      // P2SH (assume nested segwit )
      // a91407e8a3eaf30ffec25e0a2234783e2fd235d0250187
      // a914xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx87
      if (Boolean(scriptPubKey.match(/^a914[a-f0-9]{40}87$/))) {
        return TX_WEIGHT.p2wpkhInP2sh.input
      }

      // P2PK
      // 2102fe4bde2c1a5c2b4cfba984f3a6c32c5cb5e8f835c7f23b5a7ab80c848df3cfa9ac
      // 21xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxac
      if (Boolean(scriptPubKey.match(/^21[a-f0-9]{66}ac$/))) {
        return TX_WEIGHT.p2pk.input
      }
      // P2WPKH
      // 0014fc0900542fd19a3b551db93d8528c05b62528239
      // 0014xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      if (Boolean(scriptPubKey.match(/^0014[a-f0-9]{40}$/))) {
        return TX_WEIGHT.p2wpkh.input
      }
      throw new Error('scriptPubKey not supported: ' + scriptPubKey)
    }

    // Return true if P2SH (nested Segwit) or P2WPKH
    function _isSegwit(scriptPubKey) {
      return Boolean(scriptPubKey.match(/^a914[a-f0-9]{40}87$/)) || Boolean(scriptPubKey.match(/^0014[a-f0-9]{40}$/))
    }

    function _getOutputWeightFromScriptPubKey(scriptPubKey) {
      // P2PKH
      // 76a9140e8fffc70907a025e65f0bdbc5ec6bb2d326d3a788ac
      // 76a914xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx88ac
      if (Boolean(scriptPubKey.match(/^76a914[a-f0-9]{40}88ac$/))) {
        return TX_WEIGHT.p2pkh.output
      }
      // P2SH
      // a91407e8a3eaf30ffec25e0a2234783e2fd235d0250187
      // a914xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx87
      if (Boolean(scriptPubKey.match(/^a914[a-f0-9]{40}87$/))) {
        return TX_WEIGHT.p2sh.output
      }

      // P2WPKH
      // 0014fc0900542fd19a3b551db93d8528c05b62528239
      // 0014xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      if (Boolean(scriptPubKey.match(/^0014[a-f0-9]{40}$/))) {
        return TX_WEIGHT.p2wpkh.output
      }

      // OP_RETURN
      // 6a06434302150014
      // 6axxxxxxxx...xxx
      if (Boolean(scriptPubKey.match(/^6a[a-f0-9]+$/))) {
        return TX_WEIGHT.baseOutput + scriptPubKey.length * 2  // hex.length / 2 * 4
      }
      throw new Error('scriptPubKey not supported: ' + scriptPubKey)
    }

    function _getVarIntSize(value) {
      // VarInt encodes an int value into a variable data structure.
      // Computes the size
      if (value < 253) return 1
      if (value < 65536) return 3  // 2**16
      if (value < 4294967296) return 5  // 2**32
      return 9
    }

    function getTransactionWeight(tx, utxos, scriptsCache) {
      debug('getTransactionWeight')
      scriptsCache = scriptsCache || {}
      let weight = 0
      let isSegwit = false

      const inputCounterWeight = _getVarIntSize(builder.tx.ins.length) * 4
      weight += inputCounterWeight - 4
      // We remove 4 wu because TX_WEIGHT.baseTx includes the most common case: 1 byte

      // scriptsCache: map `${txid}:${index}` -> hex script
      for (const i in tx.ins) {
        const txid = b2a_hash(tx.ins[i].hash)
        const index = tx.ins[i].index

        // test cache
        if (scriptsCache[`${txid}:${index}`]) {
          // hit
        } else {
          // missed
          for (var u in utxos) {
            const utxo = utxos[u]
            if (txid === utxo.txid && index === utxo.index) {
              // input found
              // add to cache
              scriptsCache[`${txid}:${index}`] = utxo.scriptPubKey.hex
              break
            }
          }
        }

        const scriptPubKey = scriptsCache[`${txid}:${index}`]
        if (!scriptPubKey) {
          throw new Error('inputs and utxos inconsistency')
        }

        const inputWeight = _getInputWeightFromScriptPubKey(scriptPubKey)
        weight += inputWeight
        isSegwit = isSegwit || _isSegwit(scriptPubKey)
        debug(`Input ${i} weight: ${inputWeight}`)
      }
      if (isSegwit) {
        debug('It is Segwit')
        weight += TX_WEIGHT.baseTx.segwit
      }
      else {
        debug('It is legacy')
        weight += TX_WEIGHT.baseTx.legacy
      }
      for (const i in tx.outs) {
        const scriptHex = b2a_script(tx.outs[i].script)
        const outputWeight = _getOutputWeightFromScriptPubKey(scriptHex)
        weight += outputWeight
        debug(`Output ${i} weight: ${outputWeight}`)
      }
      debug(`Transation weight: ${weight}`)
      return weight
    }

    function _validateFeePerKb(actual, expected) {
      // max difference: 0.5%
      return actual >= expected && (actual - expected) / expected < 0.005
    }

    if (numOfChanges === 2 || !coloredChange) {
      // Add btc
      // use btc change if it is defined, instead use the change address
      if (args.bitcoinChangeAddress) {
        args.bitcoinChangeAddress = await resolveAddress(args.bitcoinChangeAddress, 1)
        builder.addOutput(args.bitcoinChangeAddress, btcChangeValue)
      } else {
        args.changeAddress = await resolveAddress(args.changeAddress, 2)
        builder.addOutput(args.changeAddress, btcChangeValue)
      }
    }
    if (coloredChange) {
      coloredOutputIndexes.push(builder.tx.outs.length)
      args.changeAddress = await resolveAddress(args.changeAddress, 2)
      builder.addOutput(args.changeAddress, lastOutputValue)
    }
    const unsignedTxHex = builder.tx.toHex()
    const txWeight = getTransactionWeight(builder.tx, args.utxos)
    if (args.feePerKb) {
      // Is the fee rate correct?
      const realFeePerKb = (args.fee / txWeight) * 4000
      if (!_validateFeePerKb(realFeePerKb, args.feePerKb)) {
        // Retry!
        debug('Current args.fee = ' + args.fee + ' feePerKb = ' + realFeePerKb)
        debug('Wanted feePerKb = ' + args.feePerKb + ' txWeight = ' + txWeight)
        args.fee = Math.ceil((txWeight / 4000) * args.feePerKb)
        debug('Insufficient fee rate, retry with new fee = ' + args.fee)
        continue
      }
    }
    debug('success')
    return { txHex: unsignedTxHex, coloredOutputIndexes: _.uniqBy(coloredOutputIndexes) }
  }
}

/*
 * this is a simplest version of _addInputsForSendTransaction,
 * (it is too big to add more complixity there).
 */
ColoredCoinsBuilder.prototype._buildRawModeSendTransaction = async function(txb, args) {
  var self = this
  var coloredOutputIndexes = []

  debug('buildRawModeSendTransaction')

  debug('got unspents from parmameter: ')
  debug(args.utxos)

  debug('add all the utxos to tx inputs')
  args.utxos.forEach(function(utxo) {
    txb.addInput(utxo.txid, utxo.index)
  })

  debug('reached encoder')
  var encoder = cc.newTransaction(0x4343, CC_TX_VERSION)

  debug('create outputs and payments')
  args.to.forEach(function(to) {
    const fakeInputIndex = 0
    encoder.addPayment(fakeInputIndex, to.amount, txb.tx.outs ? txb.tx.outs.length : 0)
    txb.addOutput(to.address, to.amountBtc || self.minDustValue)
  })

  debug('before using encoder')
  var buffer = encoder.encode()
  if (buffer.leftover && buffer.leftover.length > 0) {
    // We don't expect to enter here
    debug('Unsupported feature')
    throw new errors.CCTransactionConstructionError()
  }

  // add array of colored ouput indexes
  encoder.payments.forEach(function(payment) {
    if (typeof payment.output !== 'undefined') coloredOutputIndexes.push(payment.output)
  })

  debug('encoding done')
  var ret = bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, buffer.codeBuffer])
  txb.addOutput(ret, 0)

  debug('success')
  return { txHex: txb.tx.toHex(), coloredOutputIndexes: _.uniqBy(coloredOutputIndexes) }
}

ColoredCoinsBuilder.prototype.buildBurnTransaction = async function(args) {
  var self = this
  args = args || {}
  checkNotSupportedArgs(args)
  var to = args.transfer || []
  var burn = args.burn || []
  burn.forEach(function(burnItem) {
    burnItem.burn = true
  })
  to.push.apply(to, burn)
  delete args.transfer
  args.to = to
  return self.buildSendTransaction(args)
}

// encode the first upTo amounts
// return True if the encoding is valid
function testEncodeAmounts(amounts, upTo) {
  var encoder = cc.newTransaction(0x4343, CC_TX_VERSION)
  
  for(var i=0 ; i<Math.min(upTo, amounts.length) ; i++) {
    // add the amount[i] to the output with index i
    encoder.addPayment(0, amounts[i], i)
  }
  // TODO: catch the error
  var buffer = null
  try {
    buffer = encoder.encode()
  } catch (error) {
    if (error.message === 'Data code is bigger then the allowed byte size') {
      return false
    } else {
      throw error
    }
  }
  
  if (buffer.leftover && buffer.leftover.length > 0) {
    // Unsupported feature
    return false
  }
  return true
}

// ::: OpReturnLimit :::
// most common result
const FIRST_TRY_N = 12
const MAX_N = 31

function doOpReturnLimit(amounts, upTo) {

  // try n-1
  function onError() {
    return doOpReturnLimit(amounts, upTo-1)
  }
  
  // try n+1 or not
  function onSuccess() {
    if (upTo >= amounts.length) {
      // success on all amounts
      return amounts.length
    }
    return doOpReturnLimit(amounts, upTo+1)
  }

  const test = testEncodeAmounts(amounts, upTo)
  if (test && upTo >= MAX_N) {
    return MAX_N
  }
  // first try
  if (upTo === FIRST_TRY_N) {
    if (test) {
      return onSuccess()
    } else {
      return onError()
    }
  }
  // going up
  if (upTo > FIRST_TRY_N) {
    if (test) {
      return onSuccess()
    } else {
      return upTo-1
    }
  }
  // going down
  if (upTo < FIRST_TRY_N) {
    if (test) {
      return upTo
    } else {
      return onError()
    }
  }
}

ColoredCoinsBuilder.prototype.opReturnLimit = async function(args) {
  var self = this
  if (!args.amounts) {
    throw new Error('Must have "amounts"')
  }
  return doOpReturnLimit(args.amounts, FIRST_TRY_N)
}

ColoredCoinsBuilder.prototype._getHrp = function() {
  var self = this
  if (!self.assetAddressHrp) throw new Error('HRP is not defined')
  if (self.network !== 'mainnet') return 't' + self.assetAddressHrp
  else return self.assetAddressHrp
}

ColoredCoinsBuilder.prototype._getBtcHrp = function() {
  var self = this
  if (self.network === 'testnet') return 'tb'
  if (self.network === 'regtest') return 'bcrt'
  else return 'bc'
}

ColoredCoinsBuilder.prototype.toAssetBech32Address = function(address) {
  var self = this
  const hrp = self._getHrp()
  let bech32Data
  try {
    bech32Data = bech32.decode(address)
  } catch (exc) {
    throw new Error('Invalid bitcoin address')
  }
  if (bech32Data.prefix !== self._getBtcHrp())
    throw new Error('Invalid bitcoin address')
  return bech32.encode(hrp, bech32Data.words)
}

ColoredCoinsBuilder.prototype.toBitcoinBech32Address = function(address) {
  var self = this
  const hrp = self._getHrp()
  let bech32Data
  try {
    bech32Data = bech32.decode(address)
  } catch (exc) {
    throw new Error('Invalid asset address')
  }
  if (bech32Data.prefix !== hrp)
    throw new Error('Invalid asset address')
  return bech32.encode(self._getBtcHrp(), bech32Data.words)
}

ColoredCoinsBuilder.prototype._isValidBech32Address = function(address, hrp) {
  var self = this
  let bech32Data
  try {
    bech32Data = bech32.decode(address)
  } catch (exc) {
    return false
  }
  return bech32Data.prefix === hrp
}

ColoredCoinsBuilder.prototype.isValidBitcoinBech32Address = function(address) {
  var self = this
  const hrp = self._getBtcHrp()
  return self._isValidBech32Address(address, hrp)
}

ColoredCoinsBuilder.prototype.isValidAssetBech32Address = function(address) {
  var self = this
  const hrp = self._getHrp()
  return self._isValidBech32Address(address, hrp)
}

module.exports = ColoredCoinsBuilder
