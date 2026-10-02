import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWebDAVSecretStore } from './webdav-secret.js'

const roots=[]
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})})
async function fixture(available=true){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notepad-webdav-secret-'));roots.push(root)
  const safeStorage={
    isEncryptionAvailable:()=>available,
    getSelectedStorageBackend:()=>available ? 'kwallet6' : '',
    encryptString:value=>Buffer.from('sealed:'+Buffer.from(value,'utf8').toString('base64'),'utf8'),
    decryptString:buffer=>{
      const raw=buffer.toString('utf8')
      if(!raw.startsWith('sealed:'))throw new Error('bad ciphertext')
      return Buffer.from(raw.slice(7),'base64').toString('utf8')
    },
  }
  return {root,store:createWebDAVSecretStore({dataDir:root,safeStorage})}
}

describe('WebDAV OS-protected secret store',()=>{
  it('stores only encrypted bytes and can replace/load/clear the secret',async()=>{
    const {store}=await fixture()
    await store.save('first-secret')
    expect(await store.status()).toEqual({available:true,stored:true,backend:'kwallet6'})
    expect(await store.load()).toBe('first-secret')
    const raw=await fs.readFile(store.path,'utf8')
    expect(raw).not.toContain('first-secret')
    await store.save('second-secret')
    expect(await store.load()).toBe('second-secret')
    await store.clear()
    expect(await store.status()).toEqual({available:true,stored:false,backend:'kwallet6'})
    expect(await store.load()).toBe('')
  })

  it('refuses persistence when OS encryption is unavailable',async()=>{
    const {store}=await fixture(false)
    expect(await store.status()).toEqual({available:false,stored:false,backend:''})
    await expect(store.save('secret')).rejects.toThrow('不可用')
  })

  it('rejects a symlink in place of the credential file',async()=>{
    const {root,store}=await fixture()
    const dir=path.dirname(store.path)
    await fs.mkdir(dir,{recursive:true})
    const target=path.join(root,'outside.txt')
    await fs.writeFile(target,'outside')
    try{await fs.symlink(target,store.path)}catch{return}
    await expect(store.status()).rejects.toThrow('不安全')
  })

  it('rejects empty and oversized plaintext before encryption',async()=>{
    const {store}=await fixture()
    await expect(store.save('')).rejects.toThrow('格式无效')
    await expect(store.save('x'.repeat(5000))).rejects.toThrow('格式无效')
  })
})


it('treats Electron basic_text fallback as unavailable encryption',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notepad-webdav-basic-'));roots.push(root)
  const safeStorage={
    isEncryptionAvailable:()=>true,
    getSelectedStorageBackend:()=>'basic_text',
    encryptString:value=>Buffer.from(value),
    decryptString:buffer=>buffer.toString(),
  }
  const store=createWebDAVSecretStore({dataDir:root,safeStorage})
  expect(await store.status()).toEqual({available:false,stored:false,backend:'basic_text'})
  await expect(store.save('secret')).rejects.toThrow('basic_text')
})
