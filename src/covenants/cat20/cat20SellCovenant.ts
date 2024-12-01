import {
    CatPsbt,
    ChangeInfo,
    Covenant,
    InputContext,
    Postage,
    SubContractCall,
    SupportedNetwork,
    TapLeafSmartContract,
    int32,
    pubKeyPrefix,
    toXOnly,
} from '@cat-protocol/cat-sdk'
import { CAT20Sell } from '../../contracts/cat20/cat20Sell'
import { ByteString, PubKeyHash, Sig, int2ByteString } from 'scrypt-ts'

export class CAT20SellCovenant extends Covenant {
    static readonly LOCKED_ASM_VERSION = 'a883c211a6621bf16a0135c7f37013ce'

    constructor(
        cat20Script: ByteString,
        recvOutput: ByteString,
        sellerAddress: ByteString,
        price: int32,
        scalePrice: boolean,
        network?: SupportedNetwork
    ) {
        super(
            [
                {
                    contract: new CAT20Sell(
                        cat20Script,
                        recvOutput,
                        sellerAddress,
                        BigInt(price),
                        scalePrice
                    ),
                },
            ],
            {
                lockedAsmVersion: CAT20SellCovenant.LOCKED_ASM_VERSION,
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
        toBuyUserAmount: int32,
        sellChange: int32,
        buyUserAddress: PubKeyHash,
        serviceFeeInfo: ChangeInfo
    ): SubContractCall {
        return {
            method: 'take',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                toBuyUserAmount,
                sellChange,
                buyUserAddress,
                serviceFeeInfo
            ),
        }
    }

    private unlockArgsBuilder(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        toBuyUserAmount: int32,
        sellChange: int32,
        buyUserAddress: PubKeyHash,
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
            args.push(curPsbt.txState.stateHashList) //curTxoStateHashes
            args.push(1n) // tokenInputIndex
            args.push(toBuyUserAmount) // toBuyUserAmount
            args.push(sellChange) // sellChange
            args.push(buyUserAddress) // buyUserAddress
            args.push(int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)) // nftSatoshiBytes
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
            args.push(serviceFeeInfo) // serviceFeeInfo
            args.push(curPsbt.getChangeInfo())
            return args
        }
    }
}
