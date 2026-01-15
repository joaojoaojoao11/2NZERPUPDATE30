import React from 'react';
import { User } from '../types';
import AccountsReceivableModule from './AccountsReceivable';
import DebtorCollectionModule from './DebtorCollectionModule';

interface AccountsReceivableFormProps {
  user: User;
  onSuccess: () => void;
  mode: 'LISTA' | 'INADIMPLENCIA';
}

const AccountsReceivableForm: React.FC<AccountsReceivableFormProps> = ({ user, onSuccess, mode }) => {
  if (mode === 'INADIMPLENCIA') {
    return <DebtorCollectionModule currentUser={user} />;
  }
  
  // Default to LISTA mode which renders the Accounts Receivable Module
  return <AccountsReceivableModule currentUser={user} />;
};

export default AccountsReceivableForm;