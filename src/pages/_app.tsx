// src/pages/_app.tsx
import "../styles/globals.css";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import type { AppType } from "next/app";
import { trpc } from "../utils/trpc";
import React, { useState } from "react";
import LoginDialog from "@/components/LoginModal";

export const LoginContext = React.createContext({
    loginOpen: false,
    setLoginOpen: (value: boolean) => {
        // do nothing
    }
});

const MyApp: AppType<{ session: Session | null }> = ({
    Component,
    pageProps: { session, ...pageProps }
}) => {
    const [loginOpen, setLoginOpen] = useState(false);
    return (
        <SessionProvider>
            <LoginContext.Provider
                value={{
                    loginOpen,
                    setLoginOpen
                }}
            >
                <Component {...pageProps} />
            </LoginContext.Provider>
        </SessionProvider>
    );
};

export default trpc.withTRPC(MyApp);
