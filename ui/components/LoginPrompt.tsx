import React, { useState } from 'react';

interface LoginPromptProps {
    onLogin: (user: string, pass: string) => void;
    error?: string;
}

export const LoginPrompt: React.FC<LoginPromptProps> = ({ onLogin, error }) => {
    const [step, setStep] = useState<'user' | 'pass'>('user');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const submit = () => {
        if (step === 'user') {
            setStep('pass');
        } else {
            onLogin(username, password);
        }
    };

    const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
    };

    const inputProps = {
        autoFocus: true,
        onKeyDown: handleKey,
        style: {
            background: 'black',
            color: '#d4d4d4',
            border: 'none',
            outline: 'none',
        } as React.CSSProperties,
    };

    return (
        <div style={{ color: '#d4d4d4', padding: '10px' }}>
            {error && <div style={{ color: 'red' }}>{error}</div>}
            {step === 'user' ? (
                <label>
                    login: <input type="text" value={username} onChange={e => setUsername(e.target.value)} {...inputProps} />
                </label>
            ) : (
                <label>
                    password: <input type="password" value={password} onChange={e => setPassword(e.target.value)} {...inputProps} />
                </label>
            )}
        </div>
    );
};

export default LoginPrompt;
