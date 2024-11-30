import {
    CAT721Covenant,
    CAT721GuardCovenant,
    Cat721Utxo,
    CatPsbt,
    ChainProvider,
    DUST_LIMIT,
    GuardType,
    MAX_INPUT,
    Postage,
    Signer,
    TracedCat721Nft,
    UtxoProvider,
    getDummyUtxo,
    getDummyUtxos,
    hexToUint8Array,
    pickLargeFeeUtxo,
    toTokenAddress,
} from '@cat-protocol/cat-sdk'
import { CAT721SellCovenant } from '../../../covenants/cat721/cat721SellCovenant'
import { UTXO, byteString2Int } from 'scrypt-ts'
import { Psbt } from 'bitcoinjs-lib'
import { CAT721Sell } from '../../../contracts/cat721/cat721Sell'

/**
 * take a CAT721 sell order
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param cat721Covenant a {@link CAT721Covenant}
 * @param cat721SellCovenant a {@link CAT721SellCovenant}
 * @param utxoProvider a {@link UtxoProvider}
 * @param chainProvider a {@link ChainProvider}
 * @param sellNftUtxo cat721 token utxo
 * @param feeRate specify the fee rate for constructing transactions
 * @returns returns all transactions
 */
export async function takeSellOrder(
    signer: Signer,
    cat721Covenant: CAT721Covenant,
    cat721SellCovenant: CAT721SellCovenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    sellNftUtxo: Cat721Utxo,
    feeRate: number
) {
    const pubkey = await signer.getPublicKey()
    const address = await signer.getAddress()
    const changeAddress = await signer.getAddress()
    const inputNftUtxos = [sellNftUtxo]
    const tracableNfts = await CAT721Covenant.backtrace(
        inputNftUtxos.map((utxo) => {
            return { ...utxo, minterAddr: cat721Covenant.minterAddr }
        }),
        chainProvider
    )
    const inputNfts = tracableNfts.map((nft) => nft.nft)

    const { guard, outputNfts } = CAT721Covenant.createTransferGuard(
        inputNfts.map((nft, i) => ({
            nft,
            inputIndex: i + 1,
        })),
        inputNfts.map((_, i) => ({
            address: toTokenAddress(address),
            outputIndex: i + 1,
        }))
    )
    const { estGuardTxVSize, dummyGuardPsbt } = estimateGuardTxVSize(
        guard.bindToUtxo({ ...getDummyUtxo(changeAddress), script: undefined }),
        cat721SellCovenant.bindToUtxo({
            ...getDummyUtxo(changeAddress),
            script: undefined,
        }),
        changeAddress
    )

    const estSendTxVSize = estimateSentTxVSize(
        tracableNfts,
        guard,
        cat721SellCovenant,
        dummyGuardPsbt,
        address,
        pubkey,
        outputNfts,
        changeAddress,
        feeRate
    )

    const total =
        feeRate * (estGuardTxVSize + estSendTxVSize) + Postage.TOKEN_POSTAGE // for a nft change output
    const utxos = await utxoProvider.getUtxos(changeAddress, { total })

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount')
    }

    const feeUtxo = pickLargeFeeUtxo(utxos)

    const guardPsbt = buildGuardTx(
        guard,
        cat721SellCovenant,
        [feeUtxo],
        changeAddress,
        feeRate,
        estGuardTxVSize
    )

    const sendPsbt = buildSendTx(
        tracableNfts,
        guard,
        cat721SellCovenant,
        guardPsbt,
        address,
        pubkey,
        outputNfts,
        changeAddress,
        feeRate,
        estSendTxVSize
    )

    // sign the psbts
    const [signedGuardPsbt, signedSendPsbt] = await signer.signPsbts([
        {
            psbtHex: guardPsbt.toHex(),
            options: guardPsbt.psbtOptions(),
        },
        {
            psbtHex: sendPsbt.toHex(),
            options: sendPsbt.psbtOptions(),
        },
    ])

    // combine and finalize the psbts
    const guardTx = await guardPsbt
        .combine(Psbt.fromHex(signedGuardPsbt))
        .finalizeAllInputsAsync()
    const sendTx = await sendPsbt
        .combine(Psbt.fromHex(signedSendPsbt))
        .finalizeAllInputsAsync()

    // broadcast the transactions
    await chainProvider.broadcast(guardTx.extractTransaction().toHex())
    await chainProvider.broadcast(sendTx.extractTransaction().toHex())
    return { guardTx, sendTx }
}

function buildGuardTx(
    guard: CAT721GuardCovenant,
    cat721Sell: CAT721SellCovenant,
    feeUtxos: UTXO[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    if (feeUtxos.length > 1) {
        throw new Error('Only one fee input is allowed in the guard tx')
    }

    const totalIn = feeUtxos.reduce(
        (acc, utxo) => acc + BigInt(utxo.satoshis),
        0n
    )

    if (totalIn < Postage.GUARD_POSTAGE + feeRate * (estimatedVSize || 1)) {
        throw new Error('Insufficient satoshis input amount')
    }

    const guardTx = new CatPsbt()
        .addFeeInputs(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .addCovenantOutput(cat721Sell, Postage.TOKEN_POSTAGE)
        .change(changeAddress, feeRate, estimatedVSize)

    guard.bindToUtxo(guardTx.getUtxo(1))

    return guardTx
}

function estimateGuardTxVSize(
    guard: CAT721GuardCovenant,
    cat721Sell: CAT721SellCovenant,
    changeAddress: string
) {
    const dummyGuardPsbt = buildGuardTx(
        guard,
        cat721Sell,
        getDummyUtxos(changeAddress, 1),
        changeAddress,
        DUST_LIMIT
    )
    return {
        dummyGuardPsbt,
        estGuardTxVSize: dummyGuardPsbt.estimateVSize(),
    }
}

function buildSendTx(
    tracableNfts: TracedCat721Nft[],
    guard: CAT721GuardCovenant,
    cat721Sell: CAT721SellCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputNfts: (CAT721Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    const inputNfts = tracableNfts.map((nft) => nft.nft)

    if (inputNfts.length + 2 > MAX_INPUT) {
        throw new Error(
            `Too many inputs that exceed the maximum input limit of ${MAX_INPUT}`
        )
    }

    const sendPsbt = new CatPsbt()

    // add nft outputs
    for (const outputNft of outputNfts) {
        if (outputNft) {
            sendPsbt.addCovenantOutput(outputNft, Postage.TOKEN_POSTAGE)
        }
    }
    cat721Sell.bindToUtxo(guardPsbt.getUtxo(2))
    sendPsbt.addCovenantInput(cat721Sell)
    // add nft inputs
    for (const inputNft of inputNfts) {
        sendPsbt.addCovenantInput(inputNft)
    }
    const subContract = cat721Sell.getSubContract() as CAT721Sell

    sendPsbt
        .addCovenantInput(guard, GuardType.Transfer)
        .addFeeInputs([guardPsbt.getUtxo(3)])
        .addOutput({
            script: hexToUint8Array(subContract.recvOutput),
            value: byteString2Int(subContract.recvSatoshiBytes),
        })
        .change(changeAddress, feeRate, estimatedVSize)

    const inputCtxs = sendPsbt.calculateInputCtxs()
    const guardInputIndex = inputNfts.length + 1
    // unlock cat721sell
    sendPsbt.updateCovenantInput(
        0,
        cat721Sell,
        cat721Sell.take(
            0,
            inputCtxs,
            inputNfts[0].state.localId,
            toTokenAddress(address)
        )
    )
    // unlock nfts
    for (let i = 1; i < inputNfts.length + 1; i++) {
        sendPsbt.updateCovenantInput(
            i,
            inputNfts[i - 1],
            inputNfts[i - 1].contractSpend(
                i,
                inputCtxs,
                tracableNfts[i - 1].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex()),
                0
            )
        )
    }

    // unlock guard
    sendPsbt.updateCovenantInput(
        guardInputIndex,
        guard,
        guard.transfer(
            guardInputIndex,
            inputCtxs,
            outputNfts,
            guardPsbt.toTxHex()
        )
    )
    return sendPsbt
}

function estimateSentTxVSize(
    tracableNfts: TracedCat721Nft[],
    guard: CAT721GuardCovenant,
    cat721Sell: CAT721SellCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputNfts: CAT721Covenant[],
    changeAddress: string,
    feeRate: number
) {
    return buildSendTx(
        tracableNfts,
        guard,
        cat721Sell,
        guardPsbt,
        address,
        pubKey,
        outputNfts,
        changeAddress,
        feeRate
    ).estimateVSize()
}
