import { Hono } from 'hono';
import { errorCodes, updateMeSchema } from '@gear/shared';
import type { Db } from '../../db/client.ts';
import type { AuthVariables } from '../../http/auth.ts';
import { ApiError, jsonBody } from '../../http/errors.ts';
import type { AuthApi } from '../../platform/auth.ts';
import { getMe, setPhoneVerifiedAt, updateDisplayName } from './service.ts';

// R1.5: every route here acts on the caller only. None takes a user id.
export function meRoutes(db: Db, authApi: AuthApi) {
  return new Hono<{ Variables: AuthVariables }>()
    .get('/', async (c) => c.json(await getMe(db, c.get('userId'))))
    .patch('/', jsonBody(updateMeSchema), async (c) => {
      const { display_name } = c.req.valid('json');
      return c.json(await updateDisplayName(db, c.get('userId'), display_name));
    })
    .post('/phone', async (c) => {
      // R1.11: the confirmation time comes from Supabase Auth's record of the caller.
      const authUser = await authApi.getUser(c.get('accessToken'));
      if (!authUser) {
        throw new ApiError(401, errorCodes.unauthorized, 'A valid access token is required');
      }
      if (!authUser.phone_confirmed_at) {
        throw new ApiError(
          409,
          errorCodes.phoneNotVerified,
          'Supabase Auth has no phone confirmation for this account',
        );
      }
      const at = new Date(authUser.phone_confirmed_at);
      return c.json(await setPhoneVerifiedAt(db, c.get('userId'), at));
    });
}
