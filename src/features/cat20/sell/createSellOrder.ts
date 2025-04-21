import {
    ChainProvider,
    hash160,
    Int32,
    Signer,
    uint8ArrayToHex,
    UtxoProvider,
} from '@scrypt-inc/scrypt-ts-btc'
import { CAT20Sell } from '../../../contracts/cat20/cat20Sell'
import {
    CAT20Covenant,
    CAT20Utxo,
    singleSend,
    toTokenAddress,
} from '@cat-protocol/cat-sdk-v2'
import { CAT20SellCovenant } from '../../../covenants/cat20/cat20SellCovenant'
import { address as Address } from '@scrypt-inc/bitcoinjs-lib'

/**
 * create CAT20 sell order, and send cat20 to sell contract
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param cat20Covenant a {@link CAT20Covenant}
 * @param utxoProvider a {@link UtxoProvider}
 * @param chainProvider a {@link ChainProvider}
 * @param sellCAT20Utxo cat20 token utxo
 * @param price cat20 sell price
 * @param scalePrice is price scale 8bit
 * @param feeRate specify the fee rate for constructing transactions
 * @returns returns all transactions
 */
export async function createCAT20SellOrder(
    signer: Signer,
    cat20Covenant: CAT20Covenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    sellCAT20Utxos: CAT20Utxo[],
    sellAmount: Int32,
    price: bigint,
    scalePrice: boolean,
    feeRate: number
) {
    const address = await signer.getAddress()
    const userLockingScript = uint8ArrayToHex(Address.toOutputScript(address))
    const tokenAddress = toTokenAddress(address)
    const sell = new CAT20SellCovenant(
        cat20Covenant.lockingScriptHex,
        userLockingScript,
        tokenAddress,
        price,
        scalePrice
    )
    const cat20Receiver = hash160(sell.lockingScriptHex)
    const { guardTx, sendTx } = await singleSend(
        signer,
        utxoProvider,
        chainProvider,
        cat20Covenant.minterAddr,
        sellCAT20Utxos,
        [
            {
                address: cat20Receiver,
                amount: sellAmount,
            },
        ],
        tokenAddress,
        feeRate
    )
    const subContract = sell.getSubContract() as CAT20Sell
    const orderInfo = {
        cat20Script: subContract.cat20Script,
        recvOutput: subContract.recvOutput,
        sellerAddress: subContract.sellerAddress,
        sellContractAddress: cat20Receiver,
        sellAmount: sellAmount,
        price: subContract.price,
        scalePrice: subContract.scalePrice,
        txids: [
            guardTx.extractTransaction().getId(),
            sendTx.extractTransaction().getId(),
        ],
    }
    return { guardTx, sendTx, orderInfo }
}
