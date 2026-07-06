import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { router } from './router'
import { theme } from './utils/theme'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import './styles/theme.css'
import { installInspectDeterrent } from './utils/deterInspect'

installInspectDeterrent()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Treat fetched data as fresh for 5 min → navigating back to a page
      // you already visited is instant (no refetch, no blank screen).
      staleTime: 5 * 60_000,
      // Keep cached data around for 30 min after a page unmounts.
      gcTime: 30 * 60_000,
      // Show the previous data while a new query (filter/pagination) loads,
      // so lists never flash empty.
      placeholderData: keepPreviousData,
      // Don't hang through 3 retries on a real failure; one quick retry.
      retry: 1,
      retryDelay: 800,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="Application">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <RouterProvider router={router} />
          <Toaster position="top-right" toastOptions={{ style: { maxWidth: 480 } }} />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
