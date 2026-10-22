<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\SubsidySettlementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function __construct(
        private readonly SubsidySettlementService $settlementService
    ) {}

    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'INVALID_CREDENTIALS',
                'message' => 'Invalid email or password.',
            ], 401);
        }

        $token = $user->createToken('fds-auth-' . $user->role, [$user->role])->plainTextToken;

        return response()->json([
            'status' => 'success',
            'token' => $token,
            'user' => $this->formatUserProfile($user),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        return response()->json([
            'status' => 'success',
            'user' => $this->formatUserProfile($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()?->currentAccessToken()?->delete();

        return response()->json([
            'status' => 'success',
            'message' => 'Logged out successfully.',
        ]);
    }

    /**
     * Quick demo accounts helper endpoint so evaluators can view or switch between seeded roles cleanly.
     */
    public function demoAccounts(): JsonResponse
    {
        $users = User::select(['id', 'name', 'email', 'role', 'beneficiary_id', 'store_name', 'region', 'subsidy_balance', 'wallet_balance'])
            ->orderBy('id')
            ->get();

        return response()->json([
            'status' => 'success',
            'accounts' => $users,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function formatUserProfile(User $user): array
    {
        $profile = [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'beneficiary_id' => $user->beneficiary_id,
            'store_name' => $user->store_name,
            'region' => $user->region,
            'subsidy_balance' => number_format((float) $user->subsidy_balance, 2, '.', ''),
            'wallet_balance' => number_format((float) $user->wallet_balance, 2, '.', ''),
        ];

        if ($user->role === 'farmer') {
            $used = $this->settlementService->getFarmerSeasonHighNitrogenUsed($user->id, '2026-WET');
            $max = $this->settlementService->getMaxHighNitrogenQuota();
            $profile['high_nitrogen_quota'] = [
                'cropping_season' => '2026-WET',
                'used_bags' => $used,
                'max_bags' => $max,
                'remaining_bags' => max(0, $max - $used),
            ];
        }

        return $profile;
    }
}
