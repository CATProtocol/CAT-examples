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
import {
    CAT20Proto,
    ChangeInfo,
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
    StateUtils,
    TxUtil,
    TxoStateHashes,
    int32,
} from '@cat-protocol/cat-sdk'
import { OpMul } from 'scrypt-ts-lib-btc'
import { SellUtil, SpentAmountsCtx } from './sellUtil'

export class CAT20Buy extends SmartContract {
    @prop()
    cat20Script: ByteString

    @prop()
    buyerAddress: ByteString

    @prop()
    price: int32

    @prop()
    scalePrice: boolean

    constructor(
        cat20Script: ByteString,
        buyerAddress: ByteString,
        price: int32,
        scalePrice: boolean
    ) {
        super(...arguments)
        this.cat20Script = cat20Script
        this.buyerAddress = buyerAddress
        this.price = price
        this.scalePrice = scalePrice
    }

    @method()
    public take(
        curTxoStateHashes: TxoStateHashes,
        preRemainingAmount: int32,
        toBuyerAmount: int32,
        toSellerAmount: int32,
        toSellerAddress: PubKeyHash,
        tokenSatoshiBytes: ByteString,
        tokenInputIndex: int32,
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
        serviceFeeInfo: ChangeInfo,
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
            assert(prevoutsCtx.inputIndexVal == 0n)
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

            assert(
                spentScriptsCtx[Number(tokenInputIndex)] == this.cat20Script,
                'should spend the cat20Script'
            )
            SellUtil.checkSpentAmountsCtx(
                spentAmountsCtx,
                shPreimage.hashSpentAmounts
            )
            assert(toSellerAmount >= 0n, 'Invalid to seller amount')

            const preRemainingSatoshis = OpMul.mul(
                this.price,
                preRemainingAmount
            )
            assert(
                spentAmountsCtx[Number(prevoutsCtx.inputIndexVal)] ==
                    SellUtil.int32ToSatoshiBytes(
                        preRemainingSatoshis,
                        this.scalePrice
                    ),
                'Invalid preRemainingSatoshis'
            )

            assert(
                preRemainingAmount >= toBuyerAmount,
                'Insufficient satoshis balance'
            )

            // to buyer
            let curStateHashes: ByteString = hash160(
                CAT20Proto.stateHash({
                    amount: toBuyerAmount,
                    ownerAddr: this.buyerAddress,
                })
            )
            const toBuyerTokenOutput = TxUtil.buildOutput(
                this.cat20Script,
                tokenSatoshiBytes
            )

            // sell token change
            let toSellerTokenOutput = toByteString('')
            if (toSellerAmount > 0n) {
                curStateHashes += hash160(
                    CAT20Proto.stateHash({
                        amount: toSellerAmount,
                        ownerAddr: toSellerAddress,
                    })
                )
                toSellerTokenOutput = TxUtil.buildOutput(
                    this.cat20Script,
                    tokenSatoshiBytes
                )
            }

            // remaining buyer utxo satoshi
            const remainingSatoshis = OpMul.mul(
                this.price,
                preRemainingAmount - toBuyerAmount
            )
            let remainingOutput = toByteString('')
            if (remainingSatoshis > 0n) {
                const selfSpentScript =
                    spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
                remainingOutput = TxUtil.buildOutput(
                    selfSpentScript,
                    SellUtil.int32ToSatoshiBytes(
                        remainingSatoshis,
                        this.scalePrice
                    )
                )
            }

            //
            const curStateCnt: bigint = toSellerAmount == 0n ? 1n : 2n
            const stateOutput = StateUtils.getCurrentStateOutput(
                curStateHashes,
                curStateCnt,
                curTxoStateHashes
            )
            const feeOutput = TxUtil.getChangeOutput(serviceFeeInfo)
            const changeOutput = TxUtil.getChangeOutput(changeInfo)
            const hashOutputs = sha256(
                stateOutput +
                    toBuyerTokenOutput +
                    toSellerTokenOutput +
                    remainingOutput +
                    feeOutput +
                    changeOutput
            )
            assert(
                hashOutputs == shPreimage.hashOutputs,
                'hashOutputs mismatch'
            )
        }
    }
}
