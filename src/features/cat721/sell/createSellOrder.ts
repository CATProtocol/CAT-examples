import {
    ChainProvider,
    Signer,
    UtxoProvider,
    Cat721Utxo,
    toTokenAddress,
    btc,
    singleSendNft,
} from '@cat-protocol/cat-sdk'
import { CAT721SellCovenant } from '../../../covenants/cat721/cat721SellCovenant'
import { CAT721Covenant } from '@cat-protocol/cat-sdk'
import { hash160 } from 'scrypt-ts'
import { CAT721Sell } from '../../../contracts/cat721/cat721Sell'

const toLockingScript = function (address: string): string {
    return btc.Script.fromAddress(btc.Address.fromString(address)).toHex()
}

/**
 * create CAT721 sell order, and send cat721 to sell contract
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param cat721Covenant a {@link CAT721Covenant}
 * @param utxoProvider a {@link UtxoProvider}
 * @param chainProvider a {@link ChainProvider}
 * @param sellNftUtxo cat721 token utxo
 * @param price cat721 sell price
 * @param feeRate specify the fee rate for constructing transactions
 * @returns returns all transactions
 */
export async function createSellOrder(
    signer: Signer,
    cat721Covenant: CAT721Covenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    sellNftUtxo: Cat721Utxo,
    price: bigint,
    feeRate: number
) {
    const address = await signer.getAddress()
    const userLockingScript = toLockingScript(address)
    const tokenAddress = toTokenAddress(address)
    const sell = CAT721SellCovenant.createSell(
        userLockingScript,
        cat721Covenant,
        BigInt(sellNftUtxo.state.localId),
        price,
        tokenAddress
    )
    const nftReceiver = hash160(sell.lockingScriptHex)
    const { guardTx, sendTx } = await singleSendNft(
        signer,
        utxoProvider,
        chainProvider,
        cat721Covenant.minterAddr,
        [sellNftUtxo],
        [nftReceiver],
        feeRate
    )
    const subContract = sell.getSubContract() as CAT721Sell
    const orderInfo = {
        cat721Script: subContract.cat721Script,
        localId: subContract.localId,
        recvOutput: subContract.recvOutput,
        recvSatoshiBytes: subContract.recvSatoshiBytes,
        sellerAddress: subContract.sellerAddress,
        txids: [
            guardTx.extractTransaction().getId(),
            sendTx.extractTransaction().getId(),
        ],
    }
    return { guardTx, sendTx, orderInfo }
}
