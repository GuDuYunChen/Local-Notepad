import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createWorkspacePackageService, inspectWorkspacePackage, SUPPORTED_SCHEMA_VERSION } from './workspace-package.js'

it('exports and inspects schema14 workspace metadata without accepting future schemas', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'save-schema14-'))
  try {
    const dataDir=path.join(root,'data'),backups=path.join(dataDir,'backups'),filePath=path.join(root,'workspace.lnw')
    await fs.mkdir(backups,{recursive:true})
    const bytes=Buffer.alloc(4096);Buffer.from('SQLite format 3\0').copy(bytes)
    const name='backup-manual-20260928-120000-aabbccddeeff.db'
    await fs.writeFile(path.join(backups,name),bytes)
    const receipt={name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),files:1,schemaVersion:14}
    const service=createWorkspacePackageService({dataDir,appVersion:'4.189.1',runBackup:async()=>receipt,
      chooseDestination:async()=>({canceled:false,filePath}),chooseSource:async()=>({canceled:false,filePaths:[filePath]})})
    expect(SUPPORTED_SCHEMA_VERSION).toBe(14)
    expect((await service.exportPackage()).success).toBe(true)
    expect((await service.inspectPackage()).package.database.schemaVersion).toBe(14)
    receipt.schemaVersion=15
    expect((await service.exportPackage()).success).toBe(false)
  } finally {await fs.rm(root,{recursive:true,force:true})}
})
