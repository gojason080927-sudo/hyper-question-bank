import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../lib/auth/AuthProvider'
import { AppShell } from './layout/AppShell'
import { LoginPage } from '../features/auth/LoginPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { QuestionListPage } from '../features/questions/QuestionListPage'
import { QuestionNewPage } from '../features/questions/QuestionNewPage'
import { QuestionDetailPage } from '../features/questions/QuestionDetailPage'
import { QuestionEditPage } from '../features/questions/QuestionEditPage'
import { QuestionReviewPage } from '../features/questions/QuestionReviewPage'
import { QuestionReviewRedirect } from '../features/questions/QuestionReviewRedirect'
import { QuestionVersionsPage } from '../features/questions/QuestionVersionsPage'
import { PipelineReviewPage } from '../features/review/PipelineReviewPage'
import { SourceListPage } from '../features/sources/SourceListPage'
import { SourceNewPage } from '../features/sources/SourceNewPage'
import { SourceDetailPage } from '../features/sources/SourceDetailPage'

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'questions', element: <QuestionListPage /> },
      { path: 'questions/new', element: <QuestionNewPage /> },
      { path: 'questions/:problemId', element: <QuestionDetailPage /> },
      { path: 'questions/:problemId/edit', element: <QuestionEditPage /> },
      { path: 'questions/:problemId/review', element: <QuestionReviewRedirect /> },
      { path: 'questions/:problemId/versions/:versionId/review', element: <QuestionReviewPage /> },
      { path: 'questions/:problemId/versions', element: <QuestionVersionsPage /> },
      { path: 'sources', element: <SourceListPage /> },
      { path: 'sources/new', element: <SourceNewPage /> },
      { path: 'sources/:documentId', element: <SourceDetailPage /> },
      { path: 'pipeline-review', element: <PipelineReviewPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
