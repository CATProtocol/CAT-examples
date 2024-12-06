import { Ripemd160, hash160 } from 'scrypt-ts'
import { LockToMintCovenant } from '../../../covenants/cat721/lockToMintCovenant'

/**
 *
 * @param lockToMintCovenant a {@link LockToMintCovenant}
 * @returns Ripemd160
 */
export function getLockToMintLockingScriptHash(
    lockToMintCovenant: LockToMintCovenant
): Ripemd160 {
    return hash160(lockToMintCovenant.lockingScriptHex)
}
