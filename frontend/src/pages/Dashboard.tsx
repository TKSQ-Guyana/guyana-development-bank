import { useAuth } from '../auth';
import { Link } from 'react-router-dom';

export function Dashboard() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Welcome back, {user?.full_name}</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Apply for Financing</h2>
          <p className="text-sm text-slate-600 mb-4">Start a new application for a business or agricultural loan.</p>
          <Link to="/apply" className="inline-block bg-gdb-green text-white px-4 py-2 rounded-md font-medium hover:bg-gdb-green-dark">
            Start Application
          </Link>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-2">My Applications</h2>
          <p className="text-sm text-slate-600 mb-4">Track the progress of your submitted loan applications.</p>
          <Link to="/loans" className="inline-block bg-white text-gdb-green border border-gdb-green px-4 py-2 rounded-md font-medium hover:bg-slate-50">
            View Applications
          </Link>
        </div>
      </div>
    </div>
  );
}
