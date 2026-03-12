import React from 'react';

const Login: React.FC = () => {
    const handleGoogleLogin = () => {
        // Redirect to the backend OAuth initialization route
        window.location.href = '/api/auth/google/login';
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-background/50 backdrop-blur-sm bg-gradient-to-br from-indigo-50 to-white dark:from-slate-900 dark:to-slate-950 p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 shadow-xl rounded-2xl p-8 border border-slate-200 dark:border-slate-800 text-center animate-in fade-in slide-in-from-bottom-8 duration-500">

                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                    </svg>
                </div>

                <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">Welcome Back</h1>
                <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-xs mx-auto">
                    Please sign in to access your personal databoards and workspace.
                </p>

                <button
                    onClick={handleGoogleLogin}
                    className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-6 py-3 rounded-lg hover:shadow-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-all font-medium"
                >
                    <img
                        src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                        alt="Google"
                        className="w-5 h-5"
                    />
                    Sign in with Google
                </button>
            </div>
        </div>
    );
};

export default Login;
