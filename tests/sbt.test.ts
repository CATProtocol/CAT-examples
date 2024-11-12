import * as dotenv from 'dotenv'
dotenv.config()

import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import {
    MethodCallOptions,
    byteString2Int,
    fill,
    hash160,
    int2ByteString,
    toByteString,
} from 'scrypt-ts'
import {
    CAT721,
    CAT721Proto,
    CAT721State,
    ChangeInfo,
    MAX_TOKEN_OUTPUT,
    NftClosedMinter,
    NftClosedMinterProto,
    NftClosedMinterState,
    NftGuardConstState,
    NftGuardInfo,
    NftGuardProto,
    NftTransferGuard,
    emptyTokenArray,
    getBackTraceInfoSearch,
    getOutpointObj,
    getOutpointString,
    getTxCtx,
    getTxHeaderCheck,
} from '@cat-protocol/cat-smartcontracts'
import { SBT } from '../src/contracts/sbt'
import {
    UTXO,
    getBtcDummyUtxo,
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from './utils/txHelper'
import { KeyInfo, getKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import {
    CatTx,
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '@cat-protocol/cat-smartcontracts'
import { btc } from '@cat-protocol/cat-smartcontracts'
import { getNftGuardContractInfo } from './cat721'
import { nftClosedMinterCall, nftClosedMinterDeploy } from './closedMinter'
import { unlockTaprootContractInput } from './utils/contractUtils'
use(chaiAsPromised)

export async function deployNftGuardAndNoState(
    feeUtxo,
    seckey,
    guardState: NftGuardConstState,
    guardInfo: TaprootMastSmartContract,
    noStateInfo: TaprootSmartContract,
    burn: boolean,
    noStateSatoshi?: number
) {
    const catTx = CatTx.create()
    catTx.tx.from(feeUtxo)
    const atIndex = catTx.addStateContractOutput(
        guardInfo.lockingScript,
        NftGuardProto.toByteString(guardState)
    )
    const noStateAtIndex = catTx.addContractOutput(
        noStateInfo.lockingScript,
        noStateSatoshi
    )
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: burn
            ? guardInfo.contractTaprootMap.burn.contract
            : guardInfo.contractTaprootMap.transfer.contract,
        state: guardState,
        contractTaproot: burn
            ? guardInfo.contractTaprootMap.burn
            : guardInfo.contractTaprootMap.transfer,
        atOutputIndex: atIndex,
        noStateContract: noStateInfo.contract,
        noStateContractTaproot: noStateInfo,
        noStateAtOutputIndex: noStateAtIndex,
    }
}

export async function sbtCall(
    feeNftGuardUtxo,
    seckey,
    pubKeyPrefix,
    pubkeyX,
    xAddress,
    collectionNft: ContractIns<CAT721State>,
    nftGuardInfo: TaprootMastSmartContract,
    sbtTaproot: TaprootSmartContract,
    nftMinterScript: string,
    options: {
        changeInfo: ChangeInfo
        haveNftOutput?: boolean
    } = {
        changeInfo: {
            script: toByteString(''),
            satoshis: toByteString('0000000000000000'),
        },
    }
) {
    // nft
    const nftGuardState = NftGuardProto.createEmptyState()
    nftGuardState.collectionScript =
        collectionNft.contractTaproot.lockingScriptHex
    nftGuardState.localIdArray[0] = collectionNft.state.localId
    const nftGuardDeployInfo = await deployNftGuardAndNoState(
        feeNftGuardUtxo,
        seckey,
        nftGuardState,
        nftGuardInfo,
        sbtTaproot,
        !options.haveNftOutput
    )
    const sbtTx = CatTx.create()
    // add inputs
    // add nft
    const nftIndex = sbtTx.fromCatTx(
        collectionNft.catTx,
        collectionNft.atOutputIndex
    )

    // add nft guard
    const nftGuardIndex = sbtTx.fromCatTx(
        nftGuardDeployInfo.catTx,
        nftGuardDeployInfo.atOutputIndex
    )

    // add sbt
    const sbtIndex = sbtTx.fromCatTx(
        nftGuardDeployInfo.catTx,
        nftGuardDeployInfo.noStateAtOutputIndex
    )

    // add outputs
    // add nft to user output
    if (options.haveNftOutput) {
        const nftReceiver = {
            ownerAddr: xAddress,
            localId: collectionNft.state.localId,
        }
        // add outputs
        // add nft to user output
        sbtTx.addStateContractOutput(
            nftGuardState.collectionScript,
            CAT721Proto.toByteString(nftReceiver)
        )
    }
    if (options.changeInfo.script) {
        sbtTx.addContractOutput(
            options.changeInfo.script,
            Number(byteString2Int(options.changeInfo.satoshis))
        )
    }
    // unlocks
    // unlock nft input
    {
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                sbtTx.tx,
                nftIndex,
                collectionNft.contractTaproot.tapleafBuffer
            )
        const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        expect(
            btc.crypto.Schnorr.verify(seckey.publicKey, sighash.hash, sig)
        ).to.be.equal(true)
        const preTx = collectionNft.catTx.tx
        const prePreTx = collectionNft.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            collectionNft.contractTaproot.lockingScriptHex,
            nftMinterScript
        )
        const amountCheckTx = getTxHeaderCheck(nftGuardDeployInfo.catTx.tx, 1)
        const amountCheckInfo: NftGuardInfo = {
            outputIndex: getOutpointObj(nftGuardDeployInfo.catTx.tx, 1)
                .outputIndex,
            inputIndexVal: BigInt(nftGuardIndex),
            tx: amountCheckTx.tx,
            guardState: nftGuardDeployInfo.state,
        }
        await collectionNft.contract.connect(getDummySigner())
        const nftCall = await collectionNft.contract.methods.unlock(
            {
                isUserSpend: false,
                userPubKeyPrefix: toByteString(''),
                userPubKey: toByteString(''),
                userSig: sig.toString('hex'),
                contractInputIndex: BigInt(sbtIndex),
            },
            collectionNft.state,
            collectionNft.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT721>
        )
        unlockTaprootContractInput(
            nftCall,
            collectionNft.contractTaproot,
            sbtTx.tx,
            preTx,
            nftIndex,
            true,
            true
        )
    }
    // unlock nft guard
    {
        const { shPreimage, prevoutsCtx, spentScripts } = await getTxCtx(
            sbtTx.tx,
            nftGuardIndex,
            nftGuardDeployInfo.contractTaproot.tapleafBuffer
        )
        const preTx = getTxHeaderCheck(nftGuardDeployInfo.catTx.tx, 1)
        await nftGuardDeployInfo.contract.connect(getDummySigner())
        const tokenOutputMaskArray = fill(false, MAX_TOKEN_OUTPUT)
        const ownerAddrOrScriptArray = emptyTokenArray()
        const localIdList = fill(0n, MAX_TOKEN_OUTPUT)
        const outputSatoshiArray = emptyTokenArray()
        tokenOutputMaskArray[0] = true
        ownerAddrOrScriptArray[0] = xAddress
        localIdList[0] = collectionNft.state.localId
        // other output
        for (let index = 2; index < sbtTx.tx.outputs.length; index++) {
            const output = sbtTx.tx.outputs[index]
            ownerAddrOrScriptArray[index - 1] = output.script
                .toBuffer()
                .toString('hex')
            outputSatoshiArray[index - 1] = int2ByteString(
                BigInt(output.satoshis),
                8n
            )
        }
        if (options.haveNftOutput) {
            const nftTransferCheckCall =
                await nftGuardDeployInfo.contract.methods.transfer(
                    sbtTx.state.stateHashList,
                    ownerAddrOrScriptArray,
                    localIdList,
                    tokenOutputMaskArray,
                    outputSatoshiArray,
                    toByteString('4a01000000000000'),
                    nftGuardDeployInfo.state,
                    preTx.tx,
                    shPreimage,
                    prevoutsCtx,
                    spentScripts,
                    {
                        fromUTXO: getDummyUTXO(),
                        verify: false,
                        exec: false,
                    } as MethodCallOptions<NftTransferGuard>
                )
            unlockTaprootContractInput(
                nftTransferCheckCall,
                nftGuardDeployInfo.contractTaproot,
                sbtTx.tx,
                nftGuardDeployInfo.catTx.tx,
                nftGuardIndex,
                true,
                true
            )
        } else {
            const ownerAddrOrScriptArray = emptyTokenArray()
            for (let index = 1; index < sbtTx.tx.outputs.length; index++) {
                const output = sbtTx.tx.outputs[index]
                ownerAddrOrScriptArray[index - 1] =
                    sbtTx.tx.outputs[index].script.toHex()
                outputSatoshiArray[index - 1] = int2ByteString(
                    BigInt(output.satoshis),
                    8n
                )
            }
            const nftTransferCheckCall =
                await nftGuardDeployInfo.contract.methods.burn(
                    sbtTx.state.stateHashList,
                    ownerAddrOrScriptArray,
                    outputSatoshiArray,
                    nftGuardDeployInfo.state,
                    preTx.tx,
                    shPreimage,
                    prevoutsCtx,
                    {
                        fromUTXO: getDummyUTXO(),
                        verify: false,
                        exec: false,
                    } as MethodCallOptions<NftTransferGuard>
                )
            unlockTaprootContractInput(
                nftTransferCheckCall,
                nftGuardDeployInfo.contractTaproot,
                sbtTx.tx,
                nftGuardDeployInfo.catTx.tx,
                nftGuardIndex,
                true,
                true
            )
        }
    }
    // unlock sbt
    {
        const { shPreimage, sighash } = await getTxCtx(
            sbtTx.tx,
            sbtIndex,
            sbtTaproot.tapleafBuffer
        )
        const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        // const txHeader = txToTxHeader(inputTokens[0].catTx.tx)
        // const cat20TxHeader = txToTxHeaderTiny(txHeader)
        await sbtTaproot.contract.connect(getDummySigner())
        const sbtCall = await sbtTaproot.contract.methods.burn(
            pubKeyPrefix,
            pubkeyX,
            () => sig.toString('hex'),
            shPreimage,
            options.changeInfo,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<SBT>
        )
        unlockTaprootContractInput(
            sbtCall,
            sbtTaproot,
            sbtTx.tx,
            nftGuardDeployInfo.catTx.tx,
            sbtIndex,
            true,
            true
        )
    }
}

describe('Test SBT', () => {
    let keyInfo: KeyInfo
    let genesisTx: btc.Transaction
    let genesisUtxo: UTXO
    let genesisOutpoint: string
    let nftClosedMinter: NftClosedMinter
    let nftClosedMinterTaproot: TaprootSmartContract
    let nftGuardInfo: TaprootMastSmartContract
    let nft: CAT721
    let nftTaproot: TaprootSmartContract
    let initNftClosedMinterState: NftClosedMinterState
    let nftClosedMinterState: NftClosedMinterState
    let nftClosedMinterIns: ContractIns<NftClosedMinterState>
    let sbt: SBT
    let sbtTaproot: TaprootSmartContract
    let feeUtxo
    const collectionMax = 100n

    before(async () => {
        // init load
        SBT.loadArtifact()
        // key info
        keyInfo = getKeyInfoFromWif(getPrivKey())
        // dummy genesis
        const dummyGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        genesisTx = dummyGenesis.genesisTx
        genesisUtxo = dummyGenesis.genesisUtxo
        genesisOutpoint = getOutpointString(genesisTx, 0)

        {
            // cat721 minter
            nftClosedMinter = new NftClosedMinter(
                keyInfo.xAddress,
                genesisOutpoint,
                collectionMax
            )
            nftClosedMinterTaproot =
                TaprootSmartContract.create(nftClosedMinter)
            // guard
            nftGuardInfo = getNftGuardContractInfo()
            // nft
            nft = new CAT721(
                nftClosedMinterTaproot.lockingScriptHex,
                nftGuardInfo.lockingScriptHex
            )
            nftTaproot = TaprootSmartContract.create(nft)
            initNftClosedMinterState = NftClosedMinterProto.create(
                nftTaproot.lockingScriptHex,
                collectionMax,
                0n
            )
            nftClosedMinterState = initNftClosedMinterState
        }

        {
            // lockToMint
            sbt = new SBT(toByteString(keyInfo.pubKeyPrefix + keyInfo.pubkeyX))
            sbtTaproot = TaprootSmartContract.create(sbt)
        }
        // deploy nft minter
        nftClosedMinterIns = await nftClosedMinterDeploy(
            keyInfo.seckey,
            genesisUtxo,
            nftClosedMinter,
            nftClosedMinterTaproot,
            initNftClosedMinterState
        )
        feeUtxo = getBtcDummyUtxo(keyInfo.addr)
    })

    async function mintNft(nftState: CAT721State) {
        const closedMinterCallInfo = await nftClosedMinterCall(
            nftClosedMinterIns,
            nftTaproot,
            nftState,
            collectionMax
        )
        nftClosedMinterIns = closedMinterCallInfo
            .nexts[0] as ContractIns<NftClosedMinterState>
        nftClosedMinterState.nextLocalId += 1n
        return closedMinterCallInfo.nexts[1] as ContractIns<CAT721State>
    }

    describe('When nft lock sbt contract', () => {
        it('t01: should success sbt burn', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(sbtTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            await sbtCall(
                feeUtxo,
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                keyInfo.xAddress,
                nft,
                nftGuardInfo,
                sbtTaproot,
                nftClosedMinterTaproot.lockingScriptHex
            )
        })

        it('t02: should success sbt burn with change', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(sbtTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            await sbtCall(
                feeUtxo,
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                keyInfo.xAddress,
                nft,
                nftGuardInfo,
                sbtTaproot,
                nftClosedMinterTaproot.lockingScriptHex,
                {
                    changeInfo: {
                        script: new btc.Script(keyInfo.addr)
                            .toBuffer()
                            .toString('hex'),
                        satoshis: int2ByteString(1000n, 8n),
                    },
                }
            )
        })

        it('t03: should failed sbt transfer', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(sbtTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            await expect(
                sbtCall(
                    feeUtxo,
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    keyInfo.xAddress,
                    nft,
                    nftGuardInfo,
                    sbtTaproot,
                    nftClosedMinterTaproot.lockingScriptHex,
                    {
                        changeInfo: {
                            script: new btc.Script(keyInfo.addr)
                                .toBuffer()
                                .toString('hex'),
                            satoshis: int2ByteString(1000n, 8n),
                        },
                        haveNftOutput: true,
                    }
                )
            ).to.be.rejected
        })
    })
})
