// Fixture-only 8-bit phase marker: reject a stale compositor image even when
// its file hash and the separately collected DOM metadata are both valid.
const assert = require('node:assert/strict'), { inflateSync } = require('node:zlib')
const COLORS = [[17, 34, 51], [221, 238, 255]]
function verifyRasterWitness(bytes, code) {
  assert.ok(Number.isInteger(code) && code >= 1 && code <= 255)
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 33)
  assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a')
  const width=bytes.readUInt32BE(16), height=bytes.readUInt32BE(20), type=bytes[25]
  assert.ok(width>=32 && width<=4096 && height>=4 && height<=4096)
  assert.equal(bytes[24],8); assert.ok(type===2 || type===6)
  assert.equal(bytes[26],0); assert.equal(bytes[27],0); assert.equal(bytes[28],0)
  const chunks=[]
  for(let i=8;i<bytes.length;){
    assert.ok(i+12<=bytes.length)
    const n=bytes.readUInt32BE(i);assert.ok(n<=bytes.length-i-12)
    if(bytes.toString('ascii',i+4,i+8)==='IDAT')chunks.push(bytes.subarray(i+8,i+8+n))
    i+=n+12
  }
  const bpp=type===6?4:3, stride=width*bpp
  const raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height})
  assert.equal(raw.length,(stride+1)*height)
  let previous=Buffer.alloc(stride), row
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
  // Marker centers are on raster row 2; only reconstruct the needed prefix.
  for(let y=0;y<=2;y++){
    row=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)))
    const filter=raw[y*(stride+1)];assert.ok(filter<=4)
    for(let x=0;x<stride;x++){
      const a=x>=bpp?row[x-bpp]:0,b=previous[x],c=x>=bpp?previous[x-bpp]:0
      row[x]=(row[x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255
    }
    previous=row
  }
  for(let bit=0;bit<8;bit++){
    const p=(bit*4+2)*bpp
    assert.deepEqual([...row.subarray(p,p+3)],COLORS[(code>>>bit)&1], 'Stale or absent raster phase marker')
    if(bpp===4)assert.equal(row[p+3],255)
  }
  return true
}
module.exports={verifyRasterWitness}
