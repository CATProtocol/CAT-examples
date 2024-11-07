import * as dotenv from 'dotenv'
dotenv.config()

import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import {
    ByteString,
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
    GuardConstState,
    GuardInfo,
    GuardProto,
    MAX_TOKEN_INPUT,
    MAX_TOKEN_OUTPUT,
    NftClosedMinter,
    NftClosedMinterProto,
    NftClosedMinterState,
    NftGuardInfo,
    NftGuardProto,
    NftTransferGuard,
    TransferGuard,
    emptyTokenArray,
    getBackTraceInfoSearch,
    getOutpointObj,
    getOutpointString,
    getTxCtx,
    getTxHeaderCheck,
    int32,
    txToTxHeader,
    txToTxHeaderTiny,
} from '@cat-protocol/cat-smartcontracts'
import { CAT20Proto, CAT20State } from '@cat-protocol/cat-smartcontracts'
import { CAT20 } from '@cat-protocol/cat-smartcontracts'
import { ClosedMinter } from '@cat-protocol/cat-smartcontracts'
import { LockToMint } from '../src/contracts/nft/lockToMint'
import {
    UTXO,
    getBtcDummyUtxo,
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from './utils/txHelper'
import { KeyInfo, getKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import {
    closedMinterCall,
    closedMinterDeploy,
    getGuardContractInfo,
} from './cat20'
import {
    CatTx,
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '@cat-protocol/cat-smartcontracts'
import { btc } from '@cat-protocol/cat-smartcontracts'
import { getNftGuardContractInfo, nftGuardDeloy } from './cat721'
import { nftClosedMinterCall, nftClosedMinterDeploy } from './closedMinter'
import { unlockTaprootContractInput } from './utils/contractUtils'
use(chaiAsPromised)

export async function deployGuardAndNoState(
    feeUtxo,
    seckey,
    guardState: GuardConstState,
    guardInfo: TaprootMastSmartContract,
    noStateInfo: TaprootSmartContract,
    noStateSatoshi?: number
) {
    const catTx = CatTx.create()
    catTx.tx.from(feeUtxo)
    const atIndex = catTx.addStateContractOutput(
        guardInfo.lockingScript,
        GuardProto.toByteString(guardState)
    )
    const noStateAtIndex = catTx.addContractOutput(
        noStateInfo.lockingScript,
        noStateSatoshi
    )
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: guardInfo.contractTaprootMap.transfer.contract,
        state: guardState,
        contractTaproot: guardInfo.contractTaprootMap.transfer,
        atOutputIndex: atIndex,
        noStateContract: noStateInfo.contract,
        noStateContractTaproot: noStateInfo,
        noStateAtOutputIndex: noStateAtIndex,
    }
}

export async function lockToMintCall(
    feeNftGuardUtxo,
    feeTokenGuardUtxo,
    seckey,
    pubKeyPrefix,
    pubkeyX,
    xAddress,
    collectionNft: ContractIns<CAT721State>,
    inputTokens: ContractIns<CAT20State>[],
    nftGuardInfo: TaprootMastSmartContract,
    tokenGuardInfo: TaprootMastSmartContract,
    lockToMintTaproot: TaprootSmartContract,
    timeLockScriptHex: ByteString,
    lockTokenAmount: int32,
    nftMinterScript: string,
    minterScript: string,
    options: {
        changeInfo: ChangeInfo
        errorNftScript?: boolean
        errorTokenScript?: boolean
        errorTimelock?: boolean
        errorOutputTokenAmount?: boolean
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
    const nftGuardDeployInfo = await nftGuardDeloy(
        feeNftGuardUtxo,
        seckey,
        nftGuardState,
        nftGuardInfo,
        false
    )
    // ft
    const guardState = GuardProto.createEmptyState()
    guardState.tokenScript = inputTokens[0].contractTaproot.lockingScriptHex
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (inputTokens[index]) {
            guardState.inputTokenAmountArray[index + 1] =
                inputTokens[index].state.amount
        }
    }
    const lockToClaimTx = CatTx.create()

    const guardDeployInfo = await deployGuardAndNoState(
        feeTokenGuardUtxo,
        seckey,
        guardState,
        tokenGuardInfo,
        lockToMintTaproot
    )
    // add inputs
    // add nft
    let nftIndex
    if (options.errorNftScript) {
        nftIndex = lockToClaimTx.fromCatTx(
            inputTokens[0].catTx,
            inputTokens[0].atOutputIndex
        )
    } else {
        nftIndex = lockToClaimTx.fromCatTx(
            collectionNft.catTx,
            collectionNft.atOutputIndex
        )
    }

    // add tokens
    let totalTokenAmount = 0n
    for (const inputToken of inputTokens) {
        if (options.errorTokenScript) {
            lockToClaimTx.fromCatTx(
                collectionNft.catTx,
                collectionNft.atOutputIndex
            )
        } else {
            lockToClaimTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
        }
        totalTokenAmount += inputToken.state.amount
    }
    // add nft guard
    const nftGuardIndex = lockToClaimTx.fromCatTx(
        nftGuardDeployInfo.catTx,
        nftGuardDeployInfo.atOutputIndex
    )
    // add token guard
    const tokenGuardIndex = lockToClaimTx.fromCatTx(
        guardDeployInfo.catTx,
        guardDeployInfo.atOutputIndex
    )
    // add lockToMint
    const lockToMintIndex = lockToClaimTx.fromCatTx(
        guardDeployInfo.catTx,
        guardDeployInfo.noStateAtOutputIndex
    )

    const nftReceiver = {
        ownerAddr: xAddress,
        localId: collectionNft.state.localId,
    }
    // add outputs
    // add nft to user output
    lockToClaimTx.addStateContractOutput(
        nftGuardState.collectionScript,
        CAT721Proto.toByteString(nftReceiver)
    )
    // add token to timelock output
    let newTokenAmount = lockTokenAmount
    if (options.errorOutputTokenAmount) {
        newTokenAmount = lockTokenAmount - 1n
    }
    lockToClaimTx.addStateContractOutput(
        guardState.tokenScript,
        CAT20Proto.toByteString({
            ownerAddr: hash160(timeLockScriptHex),
            amount: newTokenAmount,
        })
    )
    const tokenChangeAmount = totalTokenAmount - lockTokenAmount
    if (tokenChangeAmount > 0n) {
        lockToClaimTx.addStateContractOutput(
            guardState.tokenScript,
            CAT20Proto.toByteString({
                ownerAddr: inputTokens[0].state.ownerAddr,
                amount: tokenChangeAmount,
            })
        )
    }
    // add timelock output
    if (options.errorTimelock) {
        lockToClaimTx.addContractOutput(nftGuardState.collectionScript)
    } else {
        lockToClaimTx.addContractOutput(timeLockScriptHex)
    }
    if (options.changeInfo.script) {
        lockToClaimTx.addContractOutput(
            options.changeInfo.script,
            Number(byteString2Int(options.changeInfo.satoshis))
        )
    }
    // unlocks
    // unlock nft input
    {
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                lockToClaimTx.tx,
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
                contractInputIndex: BigInt(lockToMintIndex),
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
            lockToClaimTx.tx,
            preTx,
            nftIndex,
            true,
            true
        )
    }
    // unlock tokens
    for (let i = 0; i < inputTokens.length; i++) {
        const inputToken = inputTokens[i]
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                lockToClaimTx.tx,
                i + 1,
                inputToken.contractTaproot.tapleafBuffer
            )
        const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        expect(
            btc.crypto.Schnorr.verify(seckey.publicKey, sighash.hash, sig)
        ).to.be.equal(true)
        const preTx = inputToken.catTx.tx
        const prePreTx = inputToken.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            inputToken.contractTaproot.lockingScriptHex,
            minterScript
        )
        const amountCheckTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
        const amountCheckInfo: GuardInfo = {
            outputIndex: getOutpointObj(guardDeployInfo.catTx.tx, 1)
                .outputIndex,
            inputIndexVal: BigInt(tokenGuardIndex),
            tx: amountCheckTx.tx,
            guardState: guardDeployInfo.state,
        }
        await inputToken.contract.connect(getDummySigner())
        const tokenCall = await inputToken.contract.methods.unlock(
            {
                isUserSpend: true,
                userPubKeyPrefix: pubKeyPrefix,
                userPubKey: pubkeyX,
                userSig: sig.toString('hex'),
                contractInputIndex: BigInt(inputTokens.length + 1),
            },
            inputToken.state,
            inputToken.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT20>
        )
        unlockTaprootContractInput(
            tokenCall,
            inputToken.contractTaproot,
            lockToClaimTx.tx,
            preTx,
            i + 1,
            true,
            true
        )
    }
    // unlock nft guard
    {
        const { shPreimage, prevoutsCtx, spentScripts } = await getTxCtx(
            lockToClaimTx.tx,
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
        for (let index = 2; index < lockToClaimTx.tx.outputs.length; index++) {
            const output = lockToClaimTx.tx.outputs[index]
            ownerAddrOrScriptArray[index - 1] = output.script
                .toBuffer()
                .toString('hex')
            outputSatoshiArray[index - 1] = int2ByteString(
                BigInt(output.satoshis),
                8n
            )
        }
        const nftTransferCheckCall =
            await nftGuardDeployInfo.contract.methods.transfer(
                lockToClaimTx.state.stateHashList,
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
            lockToClaimTx.tx,
            nftGuardDeployInfo.catTx.tx,
            nftGuardIndex,
            true,
            true
        )
    }
    // unlock token guard
    {
        const { shPreimage, prevoutsCtx, spentScripts } = await getTxCtx(
            lockToClaimTx.tx,
            tokenGuardIndex,
            guardDeployInfo.contractTaproot.tapleafBuffer
        )
        const preTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
        await guardDeployInfo.contract.connect(getDummySigner())
        const tokenOutputMaskArray = fill(false, MAX_TOKEN_OUTPUT)
        const tokenAmountArray = fill(0n, MAX_TOKEN_OUTPUT)
        const ownerAddrOrScriptArray = emptyTokenArray()
        const outputSatoshiArray = emptyTokenArray()
        const up = tokenChangeAmount > 0n ? 3 : 2
        for (let index = 1; index < lockToClaimTx.tx.outputs.length; index++) {
            if (index < 2 || index > up) {
                const output = lockToClaimTx.tx.outputs[index]
                ownerAddrOrScriptArray[index - 1] = output.script
                    .toBuffer()
                    .toString('hex')
                outputSatoshiArray[index - 1] = int2ByteString(
                    BigInt(output.satoshis),
                    8n
                )
            }
        }
        tokenOutputMaskArray[1] = true
        tokenAmountArray[1] = lockTokenAmount
        ownerAddrOrScriptArray[1] = hash160(timeLockScriptHex)
        if (tokenChangeAmount > 0n) {
            tokenOutputMaskArray[2] = true
            tokenAmountArray[2] = tokenChangeAmount
            ownerAddrOrScriptArray[2] = inputTokens[0].state.ownerAddr
        }
        const tokenTransferCheckCall =
            await guardDeployInfo.contract.methods.transfer(
                lockToClaimTx.state.stateHashList,
                ownerAddrOrScriptArray,
                tokenAmountArray,
                tokenOutputMaskArray,
                outputSatoshiArray,
                toByteString('4a01000000000000'),
                guardDeployInfo.state,
                preTx.tx,
                shPreimage,
                prevoutsCtx,
                spentScripts,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<TransferGuard>
            )
        unlockTaprootContractInput(
            tokenTransferCheckCall,
            guardDeployInfo.contractTaproot,
            lockToClaimTx.tx,
            guardDeployInfo.catTx.tx,
            tokenGuardIndex,
            true,
            true
        )
    }
    // unlock lockToMint
    {
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                lockToClaimTx.tx,
                lockToMintIndex,
                lockToMintTaproot.tapleafBuffer
            )
        const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        const txHeader = txToTxHeader(inputTokens[0].catTx.tx)
        const cat20TxHeader = txToTxHeaderTiny(txHeader)
        await lockToMintTaproot.contract.connect(getDummySigner())
        const lockToMintCall =
            await lockToMintTaproot.contract.methods.claimNft(
                lockToClaimTx.state.stateHashList,
                nftReceiver,
                cat20TxHeader,
                2n,
                int2ByteString(2n, 4n),
                inputTokens[0].state,
                inputTokens[0].catTx.getPreState(),
                pubKeyPrefix,
                pubkeyX,
                () => sig.toString('hex'),
                tokenChangeAmount,
                toByteString('4a01000000000000'),
                shPreimage,
                prevoutsCtx,
                spentScripts,
                options.changeInfo,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<LockToMint>
            )
        unlockTaprootContractInput(
            lockToMintCall,
            lockToMintTaproot,
            lockToClaimTx.tx,
            guardDeployInfo.catTx.tx,
            lockToMintIndex,
            true,
            true
        )
    }
}

describe('Test LockToMint', () => {
    let keyInfo: KeyInfo
    let genesisTx: btc.Transaction
    let genesisUtxo: UTXO
    let genesisOutpoint: string
    let closedMinter: ClosedMinter
    let closedMinterTaproot: TaprootSmartContract
    let nftClosedMinter: NftClosedMinter
    let nftClosedMinterTaproot: TaprootSmartContract
    let guardInfo: TaprootMastSmartContract
    let nftGuardInfo: TaprootMastSmartContract
    let token: CAT20
    let nft: CAT721
    let tokenTaproot: TaprootSmartContract
    let nftTaproot: TaprootSmartContract
    let initNftClosedMinterState: NftClosedMinterState
    let nftClosedMinterState: NftClosedMinterState
    let closedMinterIns: ContractIns<string>
    let nftClosedMinterIns: ContractIns<NftClosedMinterState>
    let lockToMint: LockToMint
    let lockToMintTaproot: TaprootSmartContract
    let feeUtxo
    let timeLockScriptHex
    const collectionMax = 100n
    const lockTokenAmount = 500n
    const lockedBlocks = 17n

    before(async () => {
        // init load
        LockToMint.loadArtifact()
        // key info
        keyInfo = getKeyInfoFromWif(getPrivKey())
        // dummy genesis
        const dummyGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        genesisTx = dummyGenesis.genesisTx
        genesisUtxo = dummyGenesis.genesisUtxo
        genesisOutpoint = getOutpointString(genesisTx, 0)

        {
            // cat20 minter
            closedMinter = new ClosedMinter(keyInfo.xAddress, genesisOutpoint)
            closedMinterTaproot = TaprootSmartContract.create(closedMinter)
            // cat20 guard
            guardInfo = getGuardContractInfo()
            // token
            token = new CAT20(
                closedMinterTaproot.lockingScriptHex,
                guardInfo.lockingScriptHex
            )
            tokenTaproot = TaprootSmartContract.create(token)
        }

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
            lockToMint = new LockToMint(
                nftTaproot.lockingScriptHex,
                tokenTaproot.lockingScriptHex,
                lockTokenAmount,
                hash160(toByteString('')),
                lockedBlocks
            )
            lockToMintTaproot = TaprootSmartContract.create(lockToMint)
        }
        // deploy token minter
        closedMinterIns = await closedMinterDeploy(
            keyInfo.seckey,
            genesisUtxo,
            closedMinter,
            tokenTaproot.lockingScriptHex
        )
        // deploy nft minter
        nftClosedMinterIns = await nftClosedMinterDeploy(
            keyInfo.seckey,
            genesisUtxo,
            nftClosedMinter,
            nftClosedMinterTaproot,
            initNftClosedMinterState
        )
        // create p2wsh timelock
        timeLockScriptHex = LockToMint.buildCatTimeLockP2wsh(
            keyInfo.pubKeyPrefix + keyInfo.pubkeyX,
            lockToMint.nonce,
            lockToMint.lockedBlocks
        )
        feeUtxo = getBtcDummyUtxo(keyInfo.addr)
    })

    async function mintToken(tokenState: CAT20State) {
        const closedMinterCallInfo = await closedMinterCall(
            closedMinterIns,
            tokenTaproot,
            tokenState,
            true
        )
        closedMinterIns = closedMinterCallInfo.nexts[0] as ContractIns<string>
        return closedMinterCallInfo.nexts[1] as ContractIns<CAT20State>
    }

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

    describe('When nft lock to mint', () => {
        it('t01: should success lock to mint no token change', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount, keyInfo.xAddress)
            )
            await lockToMintCall(
                feeUtxo,
                feeUtxo,
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                keyInfo.xAddress,
                nft,
                [token],
                nftGuardInfo,
                guardInfo,
                lockToMintTaproot,
                timeLockScriptHex,
                lockTokenAmount,
                nftClosedMinterTaproot.lockingScriptHex,
                closedMinterTaproot.lockingScriptHex
            )
        })

        it('t02: should success lock to mint no token change with fee change', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount, keyInfo.xAddress)
            )
            await lockToMintCall(
                feeUtxo,
                feeUtxo,
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                keyInfo.xAddress,
                nft,
                [token],
                nftGuardInfo,
                guardInfo,
                lockToMintTaproot,
                timeLockScriptHex,
                lockTokenAmount,
                nftClosedMinterTaproot.lockingScriptHex,
                closedMinterTaproot.lockingScriptHex,
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

        it('t03: should success lock to mint have token change', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount * 2n, keyInfo.xAddress)
            )
            await lockToMintCall(
                feeUtxo,
                feeUtxo,
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                keyInfo.xAddress,
                nft,
                [token],
                nftGuardInfo,
                guardInfo,
                lockToMintTaproot,
                timeLockScriptHex,
                lockTokenAmount,
                nftClosedMinterTaproot.lockingScriptHex,
                closedMinterTaproot.lockingScriptHex
            )
        })

        it('t04: should success lock to mint have token change with fee change', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount, keyInfo.xAddress)
            )

            await lockToMintCall(
                feeUtxo,
                feeUtxo,
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                keyInfo.xAddress,
                nft,
                [token],
                nftGuardInfo,
                guardInfo,
                lockToMintTaproot,
                timeLockScriptHex,
                lockTokenAmount,
                nftClosedMinterTaproot.lockingScriptHex,
                closedMinterTaproot.lockingScriptHex,
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

        it('t05: should failed with error nft', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount, keyInfo.xAddress)
            )
            await expect(
                lockToMintCall(
                    feeUtxo,
                    feeUtxo,
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    keyInfo.xAddress,
                    nft,
                    [token],
                    nftGuardInfo,
                    guardInfo,
                    lockToMintTaproot,
                    timeLockScriptHex,
                    lockTokenAmount,
                    nftClosedMinterTaproot.lockingScriptHex,
                    closedMinterTaproot.lockingScriptHex,
                    {
                        changeInfo: {
                            script: new btc.Script(keyInfo.addr)
                                .toBuffer()
                                .toString('hex'),
                            satoshis: int2ByteString(1000n, 8n),
                        },
                        errorNftScript: true,
                    }
                )
            ).to.be.rejected
        })

        it('t06: should failed with error token', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount, keyInfo.xAddress)
            )
            await expect(
                lockToMintCall(
                    feeUtxo,
                    feeUtxo,
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    keyInfo.xAddress,
                    nft,
                    [token],
                    nftGuardInfo,
                    guardInfo,
                    lockToMintTaproot,
                    timeLockScriptHex,
                    lockTokenAmount,
                    nftClosedMinterTaproot.lockingScriptHex,
                    closedMinterTaproot.lockingScriptHex,
                    {
                        changeInfo: {
                            script: new btc.Script(keyInfo.addr)
                                .toBuffer()
                                .toString('hex'),
                            satoshis: int2ByteString(1000n, 8n),
                        },
                        errorTokenScript: true,
                    }
                )
            ).to.be.rejected
        })

        it('t07: should failed with error timelock output', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount, keyInfo.xAddress)
            )
            await expect(
                lockToMintCall(
                    feeUtxo,
                    feeUtxo,
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    keyInfo.xAddress,
                    nft,
                    [token],
                    nftGuardInfo,
                    guardInfo,
                    lockToMintTaproot,
                    timeLockScriptHex,
                    lockTokenAmount,
                    nftClosedMinterTaproot.lockingScriptHex,
                    closedMinterTaproot.lockingScriptHex,
                    {
                        changeInfo: {
                            script: new btc.Script(keyInfo.addr)
                                .toBuffer()
                                .toString('hex'),
                            satoshis: int2ByteString(1000n, 8n),
                        },
                        errorTimelock: true,
                    }
                )
            ).to.be.rejected
        })

        it('t08: should failed with token output error amount', async () => {
            const nft = await mintNft(
                CAT721Proto.create(
                    hash160(lockToMintTaproot.lockingScriptHex),
                    nftClosedMinterState.nextLocalId
                )
            )
            const token = await mintToken(
                CAT20Proto.create(lockTokenAmount, keyInfo.xAddress)
            )
            await expect(
                lockToMintCall(
                    feeUtxo,
                    feeUtxo,
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    keyInfo.xAddress,
                    nft,
                    [token],
                    nftGuardInfo,
                    guardInfo,
                    lockToMintTaproot,
                    timeLockScriptHex,
                    lockTokenAmount,
                    nftClosedMinterTaproot.lockingScriptHex,
                    closedMinterTaproot.lockingScriptHex,
                    {
                        changeInfo: {
                            script: new btc.Script(keyInfo.addr)
                                .toBuffer()
                                .toString('hex'),
                            satoshis: int2ByteString(1000n, 8n),
                        },
                        errorOutputTokenAmount: true,
                    }
                )
            ).to.be.rejected
        })
    })
})
