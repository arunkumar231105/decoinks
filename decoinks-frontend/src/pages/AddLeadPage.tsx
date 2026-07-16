import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserRound, ClipboardCheck } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'

const SOURCES = ['Facebook Messenger','WhatsApp','Instagram','Email','Walk-in','Phone']
const CHECKS = [
  ['sizes_received','Sizes received'], ['artwork_received','Artwork received'],
  ['delivery_date_confirmed','Delivery date confirmed'],
  ['shipping_address_confirmed','Shipping address confirmed'], ['budget_confirmed','Budget confirmed'],
] as const

export function AddLeadPage() {
  const navigate = useNavigate(); const qc = useQueryClient()
  const { data: users=[] } = useQuery<any[]>({queryKey:['users','mini'],queryFn:()=>api.get('/users',{params:{limit:100}}).then(r=>r.data.data.rows)})
  const [f,setF] = useState<any>({customer_name:'',source:'Email',assigned_to:'',priority:'medium',source_campaign:'',instagram_id:'',facebook_id:'',next_followup_date:'',internal_notes:'',payment_method_pref:'',info_completeness_score:0})
  const [checks,setChecks] = useState<Record<string,boolean>>({})
  const mutation = useMutation({mutationFn:()=>api.post('/leads',{...f,assigned_to:f.assigned_to||null,next_followup_date:f.next_followup_date||null,qualification:{...checks,payment_method_pref:f.payment_method_pref||null,info_completeness_score:Number(f.info_completeness_score)}}),onSuccess:()=>{qc.invalidateQueries({queryKey:['leads']});toast.success('Lead created');navigate('/leads')},onError:(e:any)=>toast.error(e.response?.data?.message??'Failed to create lead')})
  const input=(label:string,key:string,type='text')=><div className="al-field"><label>{label}</label><input className="al-input" type={type} value={f[key]} onChange={e=>setF({...f,[key]:e.target.value})}/></div>
  return <div className="add-lead-page"><div className="al-body">
    <aside className="al-left"><section className="al-panel"><div className="al-panel-header"><UserRound size={17}/><h3>Lead</h3></div><div className="al-fields">
      {input('Customer / Prospect Name *','customer_name')}<div className="al-field"><label>Source Platform *</label><select className="al-input" value={f.source} onChange={e=>setF({...f,source:e.target.value})}>{SOURCES.map(x=><option key={x}>{x}</option>)}</select></div>
      <div className="al-field"><label>Priority</label><select className="al-input" value={f.priority} onChange={e=>setF({...f,priority:e.target.value})}>{['low','medium','high','urgent'].map(x=><option key={x}>{x}</option>)}</select></div>
      <div className="al-field"><label>Assigned User</label><select className="al-input" value={f.assigned_to} onChange={e=>setF({...f,assigned_to:e.target.value})}><option value="">Unassigned</option>{users.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select></div>
      {input('Source Campaign','source_campaign')}{input('Instagram ID','instagram_id')}{input('Facebook ID','facebook_id')}{input('Next Follow-up','next_followup_date','datetime-local')}
    </div></section></aside>
    <main className="al-center"><section className="al-panel al-section"><div className="al-section-header"><ClipboardCheck size={16}/><h4>Qualification</h4></div><div className="al-fields">
      {CHECKS.map(([k,label])=><label key={k} style={{display:'flex',gap:9,alignItems:'center'}}><input type="checkbox" checked={!!checks[k]} onChange={e=>setChecks({...checks,[k]:e.target.checked})}/>{label}</label>)}
      {input('Preferred Payment Method','payment_method_pref')}<div className="al-field"><label>Information Completeness: {f.info_completeness_score}%</label><input type="range" min="0" max="100" value={f.info_completeness_score} onChange={e=>setF({...f,info_completeness_score:e.target.value})}/></div>
      <div className="al-field"><label>Internal Notes</label><textarea className="al-textarea" rows={5} value={f.internal_notes} onChange={e=>setF({...f,internal_notes:e.target.value})}/></div>
    </div></section></main>
  </div><div className="al-bottom-bar"><div className="al-bottom-right" style={{marginLeft:'auto'}}><button className="lb-action-btn" onClick={()=>navigate(-1)}>Cancel</button><button className="lb-action-btn lb-action-primary" disabled={!f.customer_name.trim()||mutation.isPending} onClick={()=>mutation.mutate()}>{mutation.isPending?'Creating…':'Create Lead'}</button></div></div></div>
}
