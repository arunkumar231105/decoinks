import { useRef, useState } from 'react'
import { Building2, Clock, Globe, Settings2, Upload } from 'lucide-react'
import toast from '../utils/toast'

// â”€â”€â”€ Toggle component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={checked ? 'sg-toggle sg-toggle-on' : 'sg-toggle'}
      onClick={() => onChange(!checked)}
    >
      <span className="sg-toggle-thumb" />
    </button>
  )
}

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function SettingsGeneralPage() {
  const logoRef = useRef<HTMLInputElement>(null)

  // Company
  const [companyName, setCompanyName] = useState('Decoinks Printshop')
  const [tagline,     setTagline]     = useState('Custom DTF & Embroidery Specialists')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [address1,    setAddress1]    = useState('7450 NW 33rd St Suite 102')
  const [address2,    setAddress2]    = useState('')
  const [city,        setCity]        = useState('Miami')
  const [state,       setState]       = useState('FL')
  const [zip,         setZip]         = useState('33122')
  const [country,     setCountry]     = useState('United States')
  const [website,     setWebsite]     = useState('https://decoinks.com')
  const [bizPhone,    setBizPhone]    = useState('+1 (305) 555-0147')
  const [bizEmail,    setBizEmail]    = useState('info@decoinks.com')

  // Date & Time
  const [dateFormat,  setDateFormat]  = useState('MM/DD/YYYY')
  const [timeFormat,  setTimeFormat]  = useState('12-hour (AM/PM)')
  const [weekStart,   setWeekStart]   = useState('Sunday')
  const [fiscalYear,  setFiscalYear]  = useState('January')

  // Localization
  const [timezone,    setTimezone]    = useState('America/New_York (UTC-5)')
  const [currency,    setCurrency]    = useState('USD - US Dollar ($)')
  const [language,    setLanguage]    = useState('English (US)')
  const [numFormat,   setNumFormat]   = useState('1,234.56 (US/UK)')

  // Prefs
  const [darkMode,      setDarkMode]      = useState(false)
  const [dataExport,    setDataExport]    = useState(true)
  const [tips,          setTips]          = useState(true)
  const [activityLog,   setActivityLog]   = useState(true)
  const [mfa,           setMfa]           = useState(false)

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setLogoPreview(URL.createObjectURL(file))
  }

  const resetDefaults = () => {
    setCompanyName('Decoinks Printshop')
    setTagline('Custom DTF & Embroidery Specialists')
    setDateFormat('MM/DD/YYYY')
    setTimeFormat('12-hour (AM/PM)')
    setTimezone('America/New_York (UTC-5)')
    setCurrency('USD - US Dollar ($)')
    toast.success('Defaults restored')
  }

  return (
    <div className="sg-page">

      {/* â”€â”€ ROW 1: Company Info + Date & Time â”€â”€ */}
      <div className="sg-grid">

        {/* Company Information */}
        <div className="al-panel sg-card">
          <div className="sg-card-header">
            <span className="sg-card-icon" style={{ background: '#ccfbf1', color: '#0d9488' }}><Building2 size={16} /></span>
            <h3>Company Information</h3>
          </div>

          {/* Logo */}
          <div className="sg-logo-row">
            <div className="sg-logo-preview">
              {logoPreview
                ? <img src={logoPreview} alt="logo" />
                : <span className="sg-logo-placeholder">DI</span>
              }
            </div>
            <div className="sg-logo-actions">
              <p className="sg-logo-hint">PNG or SVG recommended. Max 2 MB.</p>
              <input ref={logoRef} type="file" accept=".png,.jpg,.svg" hidden onChange={handleLogoChange} />
              <button className="lb-action-btn sg-logo-btn" onClick={() => logoRef.current?.click()}>
                <Upload size={13} /> Change Logo
              </button>
            </div>
          </div>

          <div className="sg-fields">
            <div className="al-field">
              <label>Company Name</label>
              <input className="al-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="al-field">
              <label>Tagline</label>
              <input className="al-input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </div>
            <div className="al-field">
              <label>Business Email</label>
              <input type="email" className="al-input" value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} />
            </div>
            <div className="al-field">
              <label>Business Phone</label>
              <input type="tel" className="al-input" value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} />
            </div>
            <div className="al-field">
              <label>Website</label>
              <input type="url" className="al-input" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="al-field">
              <label>Address Line 1</label>
              <input className="al-input" value={address1} onChange={(e) => setAddress1(e.target.value)} />
            </div>
            <div className="al-field">
              <label>Address Line 2 <span className="al-optional">(optional)</span></label>
              <input className="al-input" value={address2} onChange={(e) => setAddress2(e.target.value)} />
            </div>
            <div className="al-field-row">
              <div className="al-field">
                <label>City</label>
                <input className="al-input" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="al-field">
                <label>State</label>
                <input className="al-input" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
            </div>
            <div className="al-field-row">
              <div className="al-field">
                <label>ZIP Code</label>
                <input className="al-input" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
              <div className="al-field">
                <label>Country</label>
                <input className="al-input" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* Date & Time Settings */}
        <div className="al-panel sg-card">
          <div className="sg-card-header">
            <span className="sg-card-icon" style={{ background: '#dbeafe', color: '#2563eb' }}><Clock size={16} /></span>
            <h3>Date &amp; Time Settings</h3>
          </div>
          <div className="sg-fields">
            <div className="al-field">
              <label>Date Format</label>
              <select className="al-input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                <option>MM/DD/YYYY</option>
                <option>DD/MM/YYYY</option>
                <option>YYYY-MM-DD</option>
                <option>DD MMM YYYY</option>
                <option>MMM DD, YYYY</option>
              </select>
            </div>
            <div className="al-field">
              <label>Time Format</label>
              <select className="al-input" value={timeFormat} onChange={(e) => setTimeFormat(e.target.value)}>
                <option>12-hour (AM/PM)</option>
                <option>24-hour</option>
              </select>
            </div>
            <div className="al-field">
              <label>Week Starts On</label>
              <select className="al-input" value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                <option>Sunday</option>
                <option>Monday</option>
                <option>Saturday</option>
              </select>
            </div>
            <div className="al-field">
              <label>Fiscal Year Starts In</label>
              <select className="al-input" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>

      </div>

      {/* â”€â”€ ROW 2: Localization + System Preferences â”€â”€ */}
      <div className="sg-grid">

        {/* Localization */}
        <div className="al-panel sg-card">
          <div className="sg-card-header">
            <span className="sg-card-icon" style={{ background: '#ede9fe', color: '#7c3aed' }}><Globe size={16} /></span>
            <h3>Localization</h3>
          </div>
          <div className="sg-fields">
            <div className="al-field">
              <label>Time Zone</label>
              <select className="al-input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {[
                  'America/New_York (UTC-5)','America/Chicago (UTC-6)','America/Denver (UTC-7)',
                  'America/Los_Angeles (UTC-8)','America/Phoenix (UTC-7)','America/Anchorage (UTC-9)',
                  'Pacific/Honolulu (UTC-10)','Europe/London (UTC+0)','Europe/Paris (UTC+1)',
                  'Europe/Berlin (UTC+1)','Asia/Dubai (UTC+4)','Asia/Kolkata (UTC+5:30)',
                  'Asia/Shanghai (UTC+8)','Asia/Tokyo (UTC+9)','Australia/Sydney (UTC+11)',
                ].map(tz => <option key={tz}>{tz}</option>)}
              </select>
            </div>
            <div className="al-field">
              <label>Currency</label>
              <select className="al-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {['USD - US Dollar ($)','EUR - Euro (€)','GBP - British Pound (£)','CAD - Canadian Dollar (C$)','AUD - Australian Dollar (A$)','JPY - Japanese Yen (¥)','INR - Indian Rupee (₹)','MXN - Mexican Peso (MX$)'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="al-field">
              <label>Default Language</label>
              <select className="al-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {['English (US)','English (UK)','Spanish','French','German','Portuguese','Chinese (Simplified)','Japanese','Arabic'].map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div className="al-field">
              <label>Number Format</label>
              <select className="al-input" value={numFormat} onChange={(e) => setNumFormat(e.target.value)}>
                <option>1,234.56 (US/UK)</option>
                <option>1.234,56 (EU)</option>
                <option>1 234,56 (FR)</option>
                <option>12,34.56 (IN)</option>
              </select>
            </div>
          </div>
        </div>

        {/* System Preferences */}
        <div className="al-panel sg-card">
          <div className="sg-card-header">
            <span className="sg-card-icon" style={{ background: '#fef3c7', color: '#b45309' }}><Settings2 size={16} /></span>
            <h3>System Preferences</h3>
          </div>
          <div className="sg-toggle-list">
            <div className="sg-toggle-row">
              <div className="sg-toggle-copy">
                <strong>Dark Mode</strong>
                <span>Switch the app to a dark color scheme</span>
              </div>
              <Toggle checked={darkMode} onChange={setDarkMode} />
            </div>
            <div className="sg-toggle-row">
              <div className="sg-toggle-copy">
                <strong>Data Export</strong>
                <span>Allow users to export data as CSV or PDF</span>
              </div>
              <Toggle checked={dataExport} onChange={setDataExport} />
            </div>
            <div className="sg-toggle-row">
              <div className="sg-toggle-copy">
                <strong>UI Tips &amp; Hints</strong>
                <span>Show contextual tips throughout the app</span>
              </div>
              <Toggle checked={tips} onChange={setTips} />
            </div>
            <div className="sg-toggle-row">
              <div className="sg-toggle-copy">
                <strong>Activity Logging</strong>
                <span>Record user actions for audit purposes</span>
              </div>
              <Toggle checked={activityLog} onChange={setActivityLog} />
            </div>
            <div className="sg-toggle-row">
              <div className="sg-toggle-copy">
                <strong>Multi-Factor Authentication</strong>
                <span>Require MFA for all users on login</span>
              </div>
              <Toggle checked={mfa} onChange={setMfa} />
            </div>
          </div>
        </div>

      </div>

      {/* Bottom bar */}
      <div className="al-bottom-bar">
        <div className="al-bottom-left">
          <button className="lb-action-btn" onClick={resetDefaults}>Reset to Defaults</button>
        </div>
        <div className="al-bottom-center" />
        <div className="al-bottom-right">
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={() => toast.success('Settings saved')}>Save Changes</button>
        </div>
      </div>

    </div>
  )
}
