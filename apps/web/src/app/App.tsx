import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { setApiHandlers } from '../api/client.ts'
import { ForgotPasswordScreen, ResetPasswordScreen, VerifyEmailScreen } from '../screens/auth/EmailLinkScreens.tsx'
import { LoginScreen } from '../screens/auth/LoginScreen.tsx'
import { RegisterScreen, WelcomeScreen } from '../screens/auth/RegisterScreen.tsx'
import { NotFoundScreen } from '../screens/NotFoundScreen.tsx'
import { TitleScreen } from '../screens/TitleScreen.tsx'
import { en } from '../strings/en.ts'
import { usePreferences, useReauth } from '../stores/app.ts'
import { Toasts, ui } from '../ui/kit.tsx'
import { useGuiScale } from '../ui/useGuiScale.ts'
import { ReauthDialog } from './ReauthDialog.tsx'
import { sessionExpired } from './Screen.tsx'
import { clearLocalData, queryClient, useMe } from './session.ts'

// Telas pesadas carregadas sob demanda (documento 03, §14)
const LibraryScreen = lazy(() => import('../screens/LibraryScreen.tsx'))
const EditorScreen = lazy(() => import('../screens/EditorScreen.tsx'))
const ReaderScreen = lazy(() => import('../screens/ReaderScreen.tsx'))
const CommunityScreen = lazy(() => import('../screens/CommunityScreen.tsx'))
const ProfileScreen = lazy(() => import('../screens/ProfileScreen.tsx'))
const FriendsScreen = lazy(() => import('../screens/FriendsScreen.tsx'))
const NotificationsScreen = lazy(() => import('../screens/NotificationsScreen.tsx'))
const SettingsScreen = lazy(() => import('../screens/SettingsScreen.tsx'))
const ModerationScreen = lazy(() => import('../screens/ModerationScreen.tsx'))
const ReportConcernScreen = lazy(() => import('../screens/ReportConcernScreen.tsx'))
const BookViewerScreen = lazy(() => import('../screens/BookViewerScreen.tsx'))
const legal = () => import('../screens/LegalScreens.tsx')
const GuidelinesScreen = lazy(() => legal().then((module) => ({ default: module.GuidelinesScreen })))
const TermsScreen = lazy(() => legal().then((module) => ({ default: module.TermsScreen })))
const PrivacyScreen = lazy(() => legal().then((module) => ({ default: module.PrivacyScreen })))

setApiHandlers({
  reauth: () => useReauth.getState().ask(),
  sessionLost: () => {
    // Só avisa quem estava logado; o visitante que recebe 401 é levado ao login pela própria tela
    if (queryClient.getQueryData(['me'])) {
      sessionExpired()
      void clearLocalData()
    }
  },
})

const Loading = () => <p className={ui.muted}>{en.common.loading}</p>

/** Telas só para quem está logado; o visitante vai para o login e volta depois. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe()
  const location = useLocation()
  if (isLoading) return <Loading />
  if (!me) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />
  return <>{children}</>
}

/** Telas só para visitantes (login, cadastro). */
function RequireGuest({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe()
  if (isLoading) return <Loading />
  if (me) return <Navigate to="/" replace />
  return <>{children}</>
}

function Preferences() {
  const { guiScale, readableFont, reduceMotion } = usePreferences()
  useGuiScale(guiScale === 'auto' ? null : guiScale)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-readable-font', readableFont)
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion)
  }, [readableFont, reduceMotion])
  return null
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Preferences />
        <Toasts />
        <ReauthDialog />
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<TitleScreen />} />
            <Route path="/login" element={<LoginScreen />} />
            <Route
              path="/register"
              element={
                <RequireGuest>
                  <RegisterScreen />
                </RequireGuest>
              }
            />
            <Route path="/welcome" element={<WelcomeScreen />} />
            <Route path="/verify-email" element={<VerifyEmailScreen />} />
            <Route
              path="/forgot-password"
              element={
                <RequireGuest>
                  <ForgotPasswordScreen />
                </RequireGuest>
              }
            />
            <Route path="/reset-password" element={<ResetPasswordScreen />} />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <LibraryScreen />
                </RequireAuth>
              }
            />
            <Route
              path="/editor/:id"
              element={
                <RequireAuth>
                  <EditorScreen />
                </RequireAuth>
              }
            />
            <Route path="/book/:id" element={<ReaderScreen />} />
            <Route path="/u/:username" element={<ProfileScreen />} />
            <Route
              path="/friends"
              element={
                <RequireAuth>
                  <FriendsScreen />
                </RequireAuth>
              }
            />
            <Route path="/community" element={<CommunityScreen />} />
            <Route
              path="/notifications"
              element={
                <RequireAuth>
                  <NotificationsScreen />
                </RequireAuth>
              }
            />
            <Route
              path="/settings/*"
              element={
                <RequireAuth>
                  <SettingsScreen />
                </RequireAuth>
              }
            />
            <Route path="/guidelines" element={<GuidelinesScreen />} />
            <Route path="/terms" element={<TermsScreen />} />
            <Route path="/privacy" element={<PrivacyScreen />} />
            <Route path="/report-concern" element={<ReportConcernScreen />} />
            <Route
              path="/mod/*"
              element={
                <RequireAuth>
                  <ModerationScreen />
                </RequireAuth>
              }
            />
            <Route path="/viewer" element={<BookViewerScreen />} />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
