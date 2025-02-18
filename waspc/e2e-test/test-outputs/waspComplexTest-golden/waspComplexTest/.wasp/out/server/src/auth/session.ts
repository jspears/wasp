import { Request as ExpressRequest } from "express";

import { type User } from "../entities/index.js"
import { type SanitizedUser } from '../server/_types/index.js'

import { auth } from "./lucia.js";
import type { Session } from "lucia";
import {
  throwInvalidCredentialsError,
  deserializeAndSanitizeProviderData,
} from "./utils.js";

import prisma from '../server/dbClient.js'

// Creates a new session for the `authId` in the database
export async function createSession(authId: string): Promise<Session> {
  return auth.createSession(authId, {});
}

export async function getSessionAndUserFromBearerToken(req: ExpressRequest): Promise<{
  user: SanitizedUser | null,
  session: Session | null,
}> {
  const authorizationHeader = req.headers["authorization"];

  if (typeof authorizationHeader !== "string") {
    return {
      user: null,
      session: null,
    };
  }

  const sessionId = auth.readBearerToken(authorizationHeader);
  if (!sessionId) {
    return {
      user: null,
      session: null,
    };
  }

  return getSessionAndUserFromSessionId(sessionId);
}

export async function getSessionAndUserFromSessionId(sessionId: string): Promise<{
  user: SanitizedUser | null,
  session: Session | null,
}> {
  const { session, user: authEntity } = await auth.validateSession(sessionId);

  if (!session || !authEntity) {
    return {
      user: null,
      session: null,
    };
  }

  return {
    session,
    user: await getUser(authEntity.userId)
  }
}

async function getUser(userId: User['id']): Promise<SanitizedUser> {
  const user = await prisma.user
    .findUnique({
      where: { id: userId },
      include: {
        auth: {
          include: {
            identities: true
          }
        }
      }
    })

  if (!user) {
    throwInvalidCredentialsError()
  }

  // TODO: This logic must match the type in _types/index.ts (if we remove the
  // password field from the object here, we must to do the same there).
  // Ideally, these two things would live in the same place:
  // https://github.com/wasp-lang/wasp/issues/965
  const deserializedIdentities = user.auth.identities.map((identity) => {
    const deserializedProviderData = deserializeAndSanitizeProviderData(
      identity.providerData,
      {
        shouldRemovePasswordField: true,
      }
    )
    return {
      ...identity,
      providerData: deserializedProviderData,
    }
  })
  return {
    ...user,
    auth: {
      ...user.auth,
      identities: deserializedIdentities,
    },
  }
}

export function invalidateSession(sessionId: string): Promise<void> {
  return auth.invalidateSession(sessionId);
}
