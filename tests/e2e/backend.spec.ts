  it('batch delete', async () => {
    // 1. Create a few files
    const f1 = await call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'bd-1', content: 'c1' }) })
    const f2 = await call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'bd-2', content: 'c2' }) })
    const f3 = await call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'bd-3', content: 'c3' }) })
    
    // 2. Batch Delete f1 and f2
    const resp = await call('/api/files/batch-delete', { 
        method: 'POST', 
        body: JSON.stringify({ ids: [f1.id, f2.id] }) 
    })
    expect(resp.ok).toBe(true)
    
    // 3. Verify they are gone (soft deleted)
    // Note: List API filters out deleted by default
    const list = await call('/api/files')
    const found1 = list.find((i: any) => i.id === f1.id)
    const found2 = list.find((i: any) => i.id === f2.id)
    const found3 = list.find((i: any) => i.id === f3.id)
    
    expect(found1).toBeUndefined()
    expect(found2).toBeUndefined()
    expect(found3).toBeTruthy() // f3 should remain
  })
