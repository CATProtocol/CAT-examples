import { OpMul } from '@scrypt-inc/scrypt-ts-lib-btc'
import { SellUtil } from './sellUtil'
import {
    SmartContract,
    prop,
    ByteString,
    method,
    PubKey,
    Sig,
    Int32,
    assert,
    TxUtils,
    TxOut,
} from '@scrypt-inc/scrypt-ts-btc'
import { CAT20, OwnerUtils } from '@cat-protocol/cat-sdk-v2'
import { DexState } from './types'

export class CAT20Buy extends SmartContract<DexState> {
    @prop()
    cat20Script: ByteString

    @prop()
    buyerAddress: ByteString

    @prop()
    price: Int32

    @prop()
    scalePrice: boolean

    constructor(
        cat20Script: ByteString,
        buyerAddress: ByteString,
        price: Int32,
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
        preRemainingAmount: Int32,
        toBuyerAmount: Int32,
        toSellerAmount: Int32,
        toSellerAddress: ByteString,
        tokenSatoshiBytes: ByteString,
        tokenInputIndex: Int32,
        // sig data
        cancel: boolean,
        pubKeyPrefix: ByteString,
        ownerPubKey: PubKey,
        ownerSig: Sig,
        serviceFeeInfo: TxOut
    ) {
        // check preimage
        if (cancel) {
            assert(
                OwnerUtils.toLockingScript(pubKeyPrefix, ownerPubKey) ==
                    this.buyerAddress
            )
            assert(this.checkSig(ownerSig, ownerPubKey))
        } else {
            assert(this.ctx.inputIndexVal == 0n)
            assert(
                this.ctx.spentScripts[Number(tokenInputIndex)] ==
                    this.cat20Script,
                'should spend the cat20Script'
            )
            assert(toSellerAmount >= 0n, 'Invalid to seller amount')
            const preRemainingSatoshis = OpMul.mul(
                this.price,
                preRemainingAmount
            )
            assert(
                this.ctx.spentAmount ==
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
            this.appendStateOutput(
                TxUtils.buildOutput(this.cat20Script, tokenSatoshiBytes),
                CAT20.stateHash({
                    ownerAddr: this.buyerAddress,
                    amount: toBuyerAmount,
                })
            )

            // sell token change
            if (toSellerAmount > 0n) {
                this.appendStateOutput(
                    TxUtils.buildOutput(this.cat20Script, tokenSatoshiBytes),
                    CAT20.stateHash({
                        ownerAddr: toSellerAddress,
                        amount: toSellerAmount,
                    })
                )
            }

            // remaining buyer utxo satoshi
            const remainingSatoshis = OpMul.mul(
                this.price,
                preRemainingAmount - toBuyerAmount
            )
            if (remainingSatoshis > 0n) {
                this.appendStateOutput(
                    TxUtils.buildOutput(
                        this.ctx.spentScript,
                        SellUtil.int32ToSatoshiBytes(
                            remainingSatoshis,
                            this.scalePrice
                        )
                    ),
                    // toByteString('') as Ripemd160
                    CAT20Buy.stateHash(this.state)
                )
            }
            const outputs =
                this.buildStateOutputs() +
                TxUtils.buildChangeOutput(serviceFeeInfo) +
                this.buildChangeOutput()
            assert(
                this.checkOutputs(outputs),
                'Outputs mismatch with the transaction context'
            )
        }
    }
}

// 4a010000000000002251203b1abe1c2d300fc9e1c41a163795a84fb8d80c619a743537972762f395fc3a21
// 4a010000000000002251203b1abe1c2d300fc9e1c41a163795a84fb8d80c619a743537972762f395fc3a21
// a0bb0d000000000022512044f22427b6a4aa5ce23787b55ababa329888d30ae01acd8ac55a6c6a95ae964d
// 4a010000000000002251203b1abe1c2d300fc9e1c41a163795a84fb8d80c619a743537972762f395fc3a21
// 4a010000000000002251203b1abe1c2d300fc9e1c41a163795a84fb8d80c619a743537972762f395fc3a21
// 7b0f86c5e05a49378c2f39124211792ae9402ee8
// ea02df13fa0c0f776d31afbaedbe4f6beae10354
// f1fd442ebf7c5a6e1fba9c1303a11ca97c1e5e62
// 5790c55fc587ac9a9d9b657c1dc522f57fe3de3c
// 532e9a45addb1f319a2750ed2a77ea580d0109da
