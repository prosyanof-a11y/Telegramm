import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './lib/trpc';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Queue from './pages/Queue';
import Analytics from './pages/Analytics';
import Documents from './pages/Documents';
import Generate from './pages/Generate';
import { LayoutDashboard, List, Clock, BarChart2, FileText, PenTool } from 'lucide-react';

function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/trpc',
          headers() {
            return {
              'x-telegram-id': '123456789', // Mock user ID for development
            };
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Router>
          <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <aside className="w-64 bg-white shadow-md">
              <div className="p-4">
                <h1 className="text-xl font-bold text-gray-800">TG Manager</h1>
              </div>
              <nav className="mt-4">
                <Link to="/" className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-200">
                  <LayoutDashboard className="mr-2 h-5 w-5" /> Дашборд
                </Link>
                <Link to="/channels" className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-200">
                  <List className="mr-2 h-5 w-5" /> Каналы
                </Link>
                <Link to="/queue" className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-200">
                  <Clock className="mr-2 h-5 w-5" /> Очередь
                </Link>
                <Link to="/analytics" className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-200">
                  <BarChart2 className="mr-2 h-5 w-5" /> Аналитика
                </Link>
                <Link to="/documents" className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-200">
                  <FileText className="mr-2 h-5 w-5" /> Документы
                </Link>
                <Link to="/generate" className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-200">
                  <PenTool className="mr-2 h-5 w-5" /> Генерация
                </Link>
              </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-8">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/channels" element={<Channels />} />
                <Route path="/queue" element={<Queue />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/generate" element={<Generate />} />
              </Routes>
            </main>
          </div>
        </Router>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default App;
