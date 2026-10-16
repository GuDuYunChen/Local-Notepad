import {useEffect,useRef} from 'react'
import {recordRecentVisit} from '../services/recentNotes.mjs'

export default function useRecentNoteTracking(file,workspace) {
  const latest=useRef(file)
  latest.current=file
  const entered=useRef(null)
  useEffect(()=>{
    if(workspace!=='notes'){entered.current=null;return}
    const current=latest.current
    if(!current||current.is_folder||current.is_deleted){entered.current=null;return}
    if(entered.current===current.id)return
    entered.current=current.id
    recordRecentVisit(current)
  },[file?.id,workspace,file?.is_folder,file?.is_deleted])
}
