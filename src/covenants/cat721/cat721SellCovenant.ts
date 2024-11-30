import {
    CatPsbt,
    Covenant,
    InputContext,
    Postage,
    SubContractCall,
    SupportedNetwork,
    TapLeafSmartContract,
    TxUtil,
    int32,
    pubKeyPrefix,
    toXOnly,
} from '@cat-protocol/cat-sdk'
import { CAT721Covenant } from '@cat-protocol/cat-sdk'
import { CAT721Sell } from '../../contracts/cat721/cat721Sell'
import {
    ByteString,
    FixedArray,
    PubKeyHash,
    Sig,
    fill,
    int2ByteString,
} from 'scrypt-ts'

export class CAT721SellCovenant extends Covenant {
    static readonly LOCKED_ASM_VERSION = '9da2131f2ea53f1c903fba825ec5fd6a'

    constructor(
        cat721Script: ByteString,
        localId: int32,
        recvOutput: ByteString,
        recvSatoshiBytes: ByteString,
        sellerAddress: ByteString,
        network?: SupportedNetwork
    ) {
        super(
            [
                {
                    contract: new CAT721Sell(
                        cat721Script,
                        BigInt(localId),
                        recvOutput,
                        recvSatoshiBytes,
                        sellerAddress
                    ),
                },
            ],
            {
                lockedAsmVersion: CAT721SellCovenant.LOCKED_ASM_VERSION,
                network,
            }
        )
    }

    serializedState() {
        return ''
    }

    static createSell(
        userLockingScript: ByteString,
        cat721Covenant: CAT721Covenant,
        sellCAT721LocalId: bigint,
        price: bigint,
        tokenAddress: ByteString
    ): CAT721SellCovenant {
        return new CAT721SellCovenant(
            cat721Covenant.lockingScriptHex,
            sellCAT721LocalId,
            userLockingScript,
            int2ByteString(price, 8n),
            tokenAddress
        )
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
                PubKeyHash('0000000000000000000000000000000000000000'),
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
        nftLocalId: int32,
        buyUserAddress: PubKeyHash
    ): SubContractCall {
        return {
            method: 'take',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                nftLocalId,
                buyUserAddress
            ),
        }
    }

    private unlockArgsBuilder(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        nftLocalId: bigint,
        buyUserAddress: PubKeyHash,
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
            const outputSatoshiList = curPsbt.getOutputSatoshisList()
            const outputScriptList = curPsbt.getOutputScriptList()
            const fullOutputList: FixedArray<ByteString, 5> = fill('', 5)
            if (!cancel) {
                for (let index = 0; index < 5; index++) {
                    fullOutputList[index] = TxUtil.buildOutput(
                        outputScriptList[index],
                        outputSatoshiList[index]
                    )
                }
            }
            const outputList: FixedArray<ByteString, 3> = fill('', 3)
            outputList[0] = fullOutputList[2]
            outputList[1] = fullOutputList[3]
            outputList[2] = fullOutputList[4]
            const args = []
            args.push(curPsbt.txState.stateHashList) //curTxoStateHashes
            args.push(1n) // nftInputIndex
            args.push(nftLocalId) // nftLocalId
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
            args.push(outputList) // outputList
            return args
        }
    }
}
