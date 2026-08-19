import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db/client";
import { upsertAppConfig } from "@/lib/db/repositories/app-config";
import { encryptToken } from "@/lib/crypto/token-cipher";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, user }) {
      if (account?.refresh_token) {
        await upsertAppConfig(db, {
          googleRefreshToken: encryptToken(account.refresh_token),
          adminEmail: user.email ?? undefined,
        });
      }
      return true;
    },
  },
});
