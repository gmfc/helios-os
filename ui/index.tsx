import React from 'react';
import ReactDOM from 'react-dom/client';
import { XTerm } from '@pablo-lion/xterm-react';

const App = () => {
    return (
        <div>
            <h1>Helios OS</h1>
            <XTerm />
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
); 