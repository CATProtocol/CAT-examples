import {
    CAT20State,
    CAT721State,
    CatPsbt,
    Covenant,
    InputContext,
    Postage,
    PreTxStatesInfo,
    SubContractCall,
    SupportedNetwork,
    TapLeafSmartContract,
    XrayedTxIdPreimg2,
    int32,
    pubKeyPrefix,
    toXOnly,
} from '@cat-protocol/cat-sdk'
import { ByteString, Sig, int2ByteString } from 'scrypt-ts'
import { LockToMint } from '../../contracts/cat721/lockToMint'

export class LockToMintCovenant extends Covenant {
    static readonly LOCKED_ASM_VERSION = '9d317c35a3c058081a43abffb8f2324f'

    constructor(
        cat721Script: ByteString,
        cat20Script: ByteString,
        lockTokenAmount: int32,
        nonce: ByteString,
        lockedBlocks: bigint,
        network?: SupportedNetwork
    ) {
        super(
            [
                {
                    contract: new LockToMint(
                        cat721Script,
                        cat20Script,
                        BigInt(lockTokenAmount),
                        nonce,
                        lockedBlocks
                    ),
                },
            ],
            {
                lockedAsmVersion: LockToMintCovenant.LOCKED_ASM_VERSION,
                network,
            }
        )
    }

    serializedState() {
        return ''
    }

    claimNft(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        nftReceiver: CAT721State,
        cat20Tx: XrayedTxIdPreimg2,
        cat20OutputVal: int32,
        cat20OutputIndex: ByteString,
        cat20State: CAT20State,
        cat20TxStatesInfo: PreTxStatesInfo,
        cat20OwnerSig: {
            isP2TR: boolean
            pubKey: ByteString
        },
        cat20Change: int32
    ): SubContractCall {
        return {
            method: 'claimNft',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                nftReceiver,
                cat20Tx,
                cat20OutputVal,
                cat20OutputIndex,
                cat20State,
                cat20TxStatesInfo,
                cat20OwnerSig,
                cat20Change
            ),
        }
    }

    private unlockArgsBuilder(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        nftReceiver: CAT721State,
        cat20Tx: XrayedTxIdPreimg2,
        cat20OutputVal: int32,
        cat20OutputIndex: ByteString,
        cat20State: CAT20State,
        cat20TxStatesInfo: PreTxStatesInfo,
        cat20OwnerSig: {
            isP2TR: boolean
            pubKey: ByteString
        },
        cat20Change: int32
    ) {
        const inputCtx = inputCtxs.get(inputIndex)
        if (!inputCtx) {
            throw new Error('Input context is not available')
        }

        return (curPsbt: CatPsbt, tapLeafContract: TapLeafSmartContract) => {
            const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx
            const args = []
            args.push(curPsbt.txState.stateHashList) //curTxoStateHashes
            args.push(nftReceiver) //
            // cat20 tx info
            args.push(cat20Tx) //
            args.push(cat20OutputVal) //
            args.push(cat20OutputIndex) //
            args.push(cat20State) //
            args.push(cat20TxStatesInfo) //
            // cat20 owner pubkey and sig
            args.push(
                cat20OwnerSig.isP2TR ? '' : pubKeyPrefix(cat20OwnerSig.pubKey)
            )
            args.push(toXOnly(cat20OwnerSig.pubKey, cat20OwnerSig.isP2TR))
            args.push(() =>
                Sig(
                    curPsbt.getSig(inputIndex, {
                        publicKey: cat20OwnerSig.pubKey,
                        disableTweakSigner: cat20OwnerSig.isP2TR ? false : true,
                    })
                )
            )
            args.push(cat20Change) //
            // satoshis locked in contract
            args.push(int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)) // nftSatoshiBytes
            // ctxs
            args.push(shPreimage) // shPreimage
            args.push(prevoutsCtx) // prevoutsCtx
            args.push(spentScriptsCtx) // spentScriptsCtx
            args.push(curPsbt.getChangeInfo()) // changeInfo
            return args
        }
    }
}
