var _ = require('lodash')
var bitcoinjs = require('bitcoinjs-lib')
var Buffer = require('safe-buffer').Buffer
var debug = require('debug')('findBestMatchByNeededAssets')

var findBestMatchByNeededAssets = function (utxos, assetList, key, txb, inputvalues, metadata) {
  debug('findBestMatchByNeededAssets: start for ' + key)

  var minInputs = metadata.minInputs || 0
  /*
   assetList
   It describes required assets. Example:
    {
      "Ua4XPaYTew2DiFNmLT9YDAnvRGeYnsiY1UwV9j": {
        "amount": 20,
        "addresses": [
          {
            "address": "mrS8spZSamejRTW2HG9xshY4pZqhB1BfLY",
            "amount": 20
          }
        ],
        "done": false,
        "change": 0,
        "encodeAmount": 0,
        "inputs": []
      }
    }
  */

  var selectedUtxos = []
  var foundAmount = 0

  // 1. try to find a utxo with such amount of the asset which is greater or equal to the target amount
  var bestGreaterOrEqualAmountUtxo = findBestGreaterOrEqualAmountUtxo(utxos, assetList, key)
  var utxosSortedByAssetAmount = _.sortBy(utxos, function (utxo) { return getUtxoAssetAmount(utxo, key) })
  if (bestGreaterOrEqualAmountUtxo) {
    debug('bestGreaterOrEqualAmountUtxo = ', bestGreaterOrEqualAmountUtxo)
    selectedUtxos[0] = bestGreaterOrEqualAmountUtxo
  } else {
    // 2. try to get some utxos where the sum of their amount of the asset greater than or equal to the remaining target amount
    debug('try to get utxos smaller than amount')
    var found = utxosSortedByAssetAmount.some(function (utxo) {
      selectedUtxos.push(utxo)
      foundAmount += getUtxoAssetAmount(utxo, key)
      return foundAmount >= assetList[key].amount
    })
    if (!found) selectedUtxos.length = 0
  }

  if (!selectedUtxos.length) {
    debug('not enough amount')
    return false
  }

  debug('add other utxos to reach the minimum inputs length')
  utxosSortedByAssetAmount.some(function (u) {
    if (!selectedUtxos.some(function(s) { return s.txid === u.txid && s.index === u.index })) {
      selectedUtxos.push(u)
    }
    return selectedUtxos.length >= minInputs
  })

  debug('selectedUtxos = ', _.map(selectedUtxos, function (utxo) { return { utxo: (utxo.txid + ':' + utxo.index), amount: getUtxoAssetAmount(utxo, key) } }))

  debug('adding inputs by assets and amounts')
  var lastAssetId
  selectedUtxos.some(function (utxo, utxoIndex) {
    utxo.assets.forEach(function (asset) {
      try {
        debug('maybe adding input for ' + asset.assetId)
        if (assetList[asset.assetId] && !assetList[asset.assetId].done) {
          debug('probably adding input for ' + asset.assetId)
          debug('transfer request: ' + assetList[asset.assetId].amount + ' available in utxo: ' + asset.amount)
          debug('adding input')
          var inputIndex = txb.tx.ins.length
          if (!txb.tx.ins.some(function (txutxo, i) {
            if (txutxo.index === utxo.index && txutxo.hash.toString('hex').split('').reverse().join('') === utxo.txid) {
              debug('more assets in same utxo')
              inputIndex = i
              return true
            }
            return false
          })) {
            txb.addInput(utxo.txid, utxo.index)
            debug('setting input value ' + utxo.value + ' actual: ' + Math.round(utxo.value))
            inputvalues.amount += Math.round(utxo.value)
            debug('setting input in asset list')
            if (metadata.flags && metadata.flags.injectPreviousOutput) {
              var chunks = bitcoinjs.script.decompile(new Buffer(utxo.scriptPubKey.hex, 'hex'))
              txb.tx.ins[txb.tx.ins.length - 1].script = bitcoinjs.script.compile(chunks)
            }
          }

          var aggregationPolicy = asset.aggregationPolicy || 'aggregatable'  // TODO - remove after all assets have this field
          var inputIndexInAsset = assetList[asset.assetId].inputs.length
          debug('inputIndex = ' + inputIndex)
          debug('utxoIndex = ' + utxoIndex)
          debug('inputIndexInAsset = ' + inputIndexInAsset)
          debug('if conditions', assetList[asset.assetId].amount, asset.amount, utxoIndex+1, minInputs)
          if (assetList[asset.assetId].amount <= asset.amount && utxoIndex+1 >= minInputs) {
            var totalamount = asset.amount
            if (aggregationPolicy === 'aggregatable' && lastAssetId === asset.assetId && assetList[asset.assetId].inputs.length) {
              debug('#1 assetList[' + asset.assetId + '].inputs[' + (inputIndexInAsset - 1) + '].amount += ' + asset.amount)
              assetList[asset.assetId].inputs[inputIndexInAsset - 1].amount += asset.amount
            } else {
              debug('#2 assetList[' + asset.assetId + '].inputs.push({ index: ' + inputIndex + ', amount: ' + asset.amount + '})')
              assetList[asset.assetId].inputs.push({index: inputIndex, amount: asset.amount})
            }
            debug('setting change')
            assetList[asset.assetId].change = totalamount - assetList[asset.assetId].amount
            debug('setting done')
            assetList[asset.assetId].done = true
          } else {
            if (aggregationPolicy === 'aggregatable' && lastAssetId === asset.assetId && assetList[asset.assetId].inputs.length) {
              debug('#3 assetList[' + asset.assetId + '].inputs[' + (inputIndexInAsset - 1) + '].amount += ' + asset.amount)
              assetList[asset.assetId].inputs[inputIndexInAsset - 1].amount += asset.amount
            } else {
              debug('#4 assetList[' + asset.assetId + '].inputs.push({ index: ' + inputIndex + ', amount: ' + asset.amount + '})')
              assetList[asset.assetId].inputs.push({index: inputIndex, amount: asset.amount})
            }
            assetList[asset.assetId].amount -= asset.amount
          }
          debug('assetList[asset.assetId]', JSON.stringify(assetList[asset.assetId]))
        } else {
          debug('not adding input for ' + asset.assetId)
        }
      } catch (e) { debug('findBestMatchByNeededAssets: error = ', e) }

      lastAssetId = asset.assetId
    })

    debug('returning ' + assetList[key].done)
    return assetList[key].done
  })
  debug('findBestMatchByNeededAssets: done')
  debug('txb', JSON.stringify(txb))
  debug('assetList', JSON.stringify(assetList))
  debug('key', JSON.stringify(key))
  debug('inputvalues', JSON.stringify(inputvalues))
  return true
}

var findBestGreaterOrEqualAmountUtxo = function (utxos, assetList, key) {
  debug('findBestGreaterOrEqualAmountUtxo for ', key)
  debug('assetList[' + key + '].amount = ', assetList[key].amount)
  var foundLargerOrEqualAmountUtxo = false

  utxos.forEach(function (utxo) {
    utxo.score = 0
    var assetAmount = getUtxoAssetAmount(utxo, key)
    if (assetAmount < assetList[key].amount) {
      // debug('for utxo ' + utxo.txid + ':' + utxo.index + ', assetAmount = ' + assetAmount + ', no score.')
      return
    }
    foundLargerOrEqualAmountUtxo = true
    if (assetAmount === assetList[key].amount) {
      // debug('for utxo ' + utxo.txid + ':' + utxo.index + ', assetAmount = ' + assetAmount + ', score += 10000')
      utxo.score += 10000
    } else {  // assetAmount > assetList[key].amount
      // debug('for utxo ' + utxo.txid + ':' + utxo.index + ', assetAmount = ' + assetAmount + ', score += 1000')
      utxo.score += 1000
    }

    for (var assetId in assetList) {
      if (assetId === key) continue

      assetAmount = getUtxoAssetAmount(utxo, assetId)
      debug('checking assetId = ' + assetId)
      if (assetAmount === assetList[assetId].amount) {
        debug('for utxo ' + utxo.txid + ':' + utxo.index + ', assetAmount = ' + assetAmount + ', score += 100')
        utxo.score += 100
      } else if (assetAmount > assetList[assetId].amount) {
        debug('for utxo ' + utxo.txid + ':' + utxo.index + ', assetAmount = ' + assetAmount + ', score += 10')
        utxo.score += 10
      } else {  // assetAmount < assetList[assetId].amount
        debug('for utxo ' + utxo.txid + ':' + utxo.index + ', assetAmount = ' + assetAmount + ', score += ' + (assetAmount / assetList[assetId].amount))
        utxo.score += assetAmount / assetList[assetId].amount
      }
    }
  })

  debug('findBestGreaterOrEqualAmountUtxo: done iterating over utxos')
  return foundLargerOrEqualAmountUtxo && _.maxBy(utxos, function (utxo) { return utxo.score })
}

var getUtxoAssetAmount = function (utxo, assetId) {
  return _(utxo.assets).filter(function (asset) { return asset.assetId === assetId }).sumBy('amount')
}

module.exports = findBestMatchByNeededAssets
