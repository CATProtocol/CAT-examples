import {
    ByteString,
    PubKey,
    PubKeyHash,
    Sig,
    SmartContract,
    assert,
    hash160,
    method,
    prop,
    sha256,
    toByteString,
} from 'scrypt-ts'
import { ChangeInfo, TxUtil, int32 } from '@cat-protocol/cat-smartcontracts'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '@cat-protocol/cat-smartcontracts'
import { StateUtils, TxoStateHashes } from '@cat-protocol/cat-smartcontracts'
import { CAT20Proto } from '@cat-protocol/cat-smartcontracts'
import { SellUtil, SpentAmountsCtx } from './sellUtil'

export class BuyCAT20 extends SmartContract {
    @prop()
    cat20Script: ByteString

    @prop()
    recvOutput: ByteString

    @prop()
    buyerAddress: ByteString

    constructor(
        cat20Script: ByteString,
        recvOutput: ByteString,
        buyerAddress: ByteString
    ) {
        super(...arguments)
        this.cat20Script = cat20Script
        this.recvOutput = recvOutput
        this.buyerAddress = buyerAddress
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        preRemainingSatoshis: int32,
        toBuyerAmount: int32,
        toSellerAmount: int32,
        buyUserAddress: PubKeyHash,
        tokenSatoshiBytes: ByteString,
        // sig data
        cancel: boolean,
        pubKeyPrefix: ByteString,
        ownerPubKey: PubKey,
        ownerSig: Sig,
        // ctxs
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
        spentAmountsCtx: SpentAmountsCtx,
        changeInfo: ChangeInfo
    ) {
        // check preimage
        if (cancel) {
            assert(hash160(pubKeyPrefix + ownerPubKey) == this.buyerAddress)
            assert(this.checkSig(ownerSig, ownerPubKey))
        } else {
            // Check sighash preimage.
            assert(
                this.checkSig(
                    SigHashUtils.checkSHPreimage(shPreimage),
                    SigHashUtils.Gx
                ),
                'preimage check error'
            )
            // check ctx
            SigHashUtils.checkPrevoutsCtx(
                prevoutsCtx,
                shPreimage.hashPrevouts,
                shPreimage.inputIndex
            )
            SigHashUtils.checkSpentScriptsCtx(
                spentScriptsCtx,
                shPreimage.hashSpentScripts
            )
            SellUtil.checkSpentAmountsCtx(
                spentAmountsCtx,
                shPreimage.hashSpentAmounts
            )
            assert(toSellerAmount >= 0n)
            assert(preRemainingSatoshis >= toBuyerAmount)

            // to buyer
            let curStateHashes: ByteString = hash160(
                CAT20Proto.stateHash({
                    amount: toBuyerAmount,
                    ownerAddr: buyUserAddress,
                })
            )
            const toBuyerTokenOutput = TxUtil.buildOutput(
                this.cat20Script,
                tokenSatoshiBytes
            )

            // sell token change
            let toSellerTokenOutput = toByteString('')
            if (toSellerAmount > 0n) {
                const contractAddress = hash160(
                    spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
                )
                curStateHashes += hash160(
                    CAT20Proto.stateHash({
                        amount: toSellerAmount,
                        ownerAddr: contractAddress,
                    })
                )
                toSellerTokenOutput = TxUtil.buildOutput(
                    this.cat20Script,
                    tokenSatoshiBytes
                )
            }

            // remaining buyer utxo satoshi
            const remainingSatoshis = preRemainingSatoshis - toBuyerAmount
            assert(remainingSatoshis >= 0n)
            let remainingOutput = toByteString('')
            if (remainingSatoshis > 0n) {
                remainingOutput = TxUtil.buildOutput(
                    this.recvOutput,
                    // token 1 decimals = 1 satoshi
                    SellUtil.int32ToSatoshiBytes(remainingSatoshis)
                )
            }

            //
            const curStateCnt: bigint = toSellerAmount == 0n ? 1n : 2n
            const stateOutput = StateUtils.getCurrentStateOutput(
                curStateHashes,
                curStateCnt,
                curTxoStateHashes
            )
            const changeOutput = TxUtil.getChangeOutput(changeInfo)
            const hashOutputs = sha256(
                stateOutput +
                    toBuyerTokenOutput +
                    toSellerTokenOutput +
                    remainingOutput +
                    changeOutput
            )
            assert(
                hashOutputs == shPreimage.hashOutputs,
                'hashOutputs mismatch'
            )
        }
    }
}
