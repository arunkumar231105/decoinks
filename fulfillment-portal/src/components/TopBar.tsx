import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../store/authStore'
import { useQuery } from '@tanstack/react-query'
import api from '../services/api'

interface Props {
  title: string
}

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
]

export default function TopBar({ title }: Props) {
  const { supplier } = useAuthStore()
  const { i18n } = useTranslation()

  const { data } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => api.get('/notifications').then((r) => r.data),
    refetchInterval: 30000,
  })

  const unread = data?.notifications?.filter((n: { is_read: boolean }) => !n.is_read).length ?? 0

  return (
    <header className="fixed top-0 left-[220px] right-0 h-16 bg-white border-b border-gray-100 shadow-sm flex items-center justify-between px-6 z-20">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      </div>
      <div className="flex items-center gap-4">

        {/* Language switcher */}
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
          {LANGS.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={[
                'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
                i18n.language === lang.code
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Notifications */}
        <button
          className="relative p-2 text-gray-500 hover:text-gray-700 transition-colors"
          onClick={() => window.location.assign('/profile')}
        >
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* Supplier avatar */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">
              {supplier?.name?.charAt(0) ?? 'S'}
            </span>
          </div>
          <span className="text-sm text-gray-700 font-medium">{supplier?.name}</span>
        </div>
      </div>
    </header>
  )
}
