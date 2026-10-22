<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserRole
{
    /**
     * Handle an incoming request and verify that the authenticated user's role matches the required guard.
     */
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'UNAUTHENTICATED',
                'message' => 'Authentication token is required.',
            ], 401);
        }

        if (!in_array($user->role, $roles, true)) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'FORBIDDEN_ROLE_ACCESS',
                'message' => sprintf(
                    'Role-scoped access denied: Endpoint requires role [%s], but authenticated user has role [%s].',
                    implode(' or ', $roles),
                    $user->role
                ),
            ], 403);
        }

        return $next($request);
    }
}
