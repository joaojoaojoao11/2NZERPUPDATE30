
import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  // Fix: Added 'info' to the type definition to support informational toasts.
  type: 'success' | 'error' | 'warning' | 'info';
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const getStyle = () => {
    switch (type) {
      case 'success': return 'bg-emerald-600 text-white';
      case 'error': return 'bg-red-600 text-white';
      case 'warning': return 'bg-amber-500 text-white';
      // Fix: Added style for the 'info' type.
      case 'info': return 'bg-blue-600 text-white';
      default: return 'bg-slate-800 text-white';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success': return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>;
      case 'error': return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>;
      case 'warning': return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
      // Fix: Added icon for the 'info' type.
      case 'info': return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
    }
  };

  return (
    <div className={`fixed bottom-8 right-8 px-6 py-4 rounded-xl shadow-2xl z-[300] flex items-center space-x-4 animate-in slide-in-from-right-10 duration-300 ${getStyle()}`}>
      <div className="shrink-0">
        {getIcon()}
      </div>
      <span className="font-black uppercase text-[10px] tracking-widest">{message}</span>
    </div>
  );
};

export default Toast;
