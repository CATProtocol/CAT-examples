import {
    CatPsbt,
    ChangeInfo,
    Covenant,
    InputContext,
    MAX_INPUT,
    Postage,
    SubContractCall,
    SupportedNetwork,
    TapLeafSmartContract,
    int32,
    pubKeyPrefix,
    toXOnly,
} from '@cat-protocol/cat-sdk'
import { CAT20Buy } from '../../contracts/cat20/cat20Buy'
import { ByteString, PubKeyHash, Sig, fill, int2ByteString } from 'scrypt-ts'

export class CAT20BuyCovenant extends Covenant {
    static readonly LOCKED_ASM_VERSION = 'bd02b34ae48b220389a8b3a4096e7a7f'

    constructor(
        cat20Script: ByteString,
        buyerAddress: ByteString,
        price: int32,
        scalePrice: boolean,
        network?: SupportedNetwork
    ) {
        super(
            [
                {
                    contract: new CAT20Buy(
                        cat20Script,
                        buyerAddress,
                        BigInt(price),
                        scalePrice
                    ),
                },
            ],
            {
                lockedAsmVersion: CAT20BuyCovenant.LOCKED_ASM_VERSION,
                network,
            }
        )
    }

    serializedState() {
        return ''
    }

    cancel(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        isP2TR: boolean,
        pubKey: ByteString
    ): SubContractCall {
        return {
            method: 'take',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                0n,
                0n,
                PubKeyHash('00'),
                {
                    script: '',
                    satoshis: '0000000000000000',
                },
                {
                    isP2TR,
                    pubKey,
                }
            ),
        }
    }

    take(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        toBuyAmount: int32,
        toSellerAmount: int32,
        toSellerAddress: PubKeyHash,
        serviceFeeInfo: ChangeInfo
    ): SubContractCall {
        return {
            method: 'take',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                toBuyAmount,
                toSellerAmount,
                toSellerAddress,
                serviceFeeInfo
            ),
        }
    }

    private unlockArgsBuilder(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        toBuyerAmount: int32,
        toSellerAmount: int32,
        toSellerAddress: PubKeyHash,
        serviceFeeInfo: ChangeInfo,
        cancel?: {
            isP2TR: boolean
            pubKey: ByteString
        }
    ) {
        const inputCtx = inputCtxs.get(inputIndex)
        if (!inputCtx) {
            throw new Error('Input context is not available')
        }

        return (curPsbt: CatPsbt, tapLeafContract: TapLeafSmartContract) => {
            const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx
            const args = []
            const spentAmountsCtx = fill('', MAX_INPUT)
            for (let index = 0; index < curPsbt.data.inputs.length; index++) {
                spentAmountsCtx[index] = int2ByteString(
                    curPsbt.data.inputs[index].witnessUtxo.value,
                    8n
                )
            }
            const subContract = this.getSubContract() as CAT20Buy
            let preRemainingAmount =
                curPsbt.data.inputs[inputIndex].witnessUtxo.value /
                subContract.price
            if (subContract.scalePrice) {
                preRemainingAmount = preRemainingAmount / 256n
            }
            args.push(curPsbt.txState.stateHashList) //curTxoStateHashes
            args.push(preRemainingAmount) // preRemainingAmount
            args.push(toBuyerAmount) // toBuyerAmount
            args.push(toSellerAmount) // toSellerAmount
            args.push(toSellerAddress) // toSellerAddress
            args.push(int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)) // tokenSatoshiBytes
            args.push(1n) // tokenInputIndex
            if (cancel) {
                args.push(true)
                args.push(cancel.isP2TR ? '' : pubKeyPrefix(cancel.pubKey))
                args.push(toXOnly(cancel.pubKey, cancel.isP2TR))
                args.push(() =>
                    Sig(
                        curPsbt.getSig(inputIndex, {
                            publicKey: cancel.pubKey,
                            disableTweakSigner: cancel.isP2TR ? false : true,
                        })
                    )
                )
            } else {
                args.push(false)
                args.push('')
                args.push('')
                args.push(() => Sig('00'))
            }
            args.push(shPreimage) // shPreimage
            args.push(prevoutsCtx) // prevoutsCtx
            args.push(spentScriptsCtx) // spentScriptsCtx
            args.push(spentAmountsCtx) // spentAmountsCtx
            args.push(serviceFeeInfo) // serviceFeeInfo
            args.push(curPsbt.getChangeInfo())
            return args
        }
    }
}
