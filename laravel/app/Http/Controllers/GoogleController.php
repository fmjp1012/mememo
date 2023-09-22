<?php

namespace App\Http\Controllers;

use App\Models\GoogleAccount;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Laravel\Socialite\Facades\Socialite;

class GoogleController extends Controller
{
    public function redirectToGoogle()
    {
        return Socialite::driver('google')->redirect();
    }

    public function handleGoogleCallback()
    {
        try {
            $googleAccount = Socialite::driver('google')->user();
        } catch (\Exception $e) {
            return redirect('/')->with('error', 'Google login failed');
        }

        $existingGoogleAccount = GoogleAccount::where('google_id', $googleAccount->getId())->first();

        // GoogleAccountがDBに存在しない場合、まずUserを新規作成
        if (is_null($existingGoogleAccount)) {
            $newUser = User::create(
                ['user_name' => $googleAccount->getName()]
            );

            GoogleAccount::create([
                'user_id' => $newUser->id,
                'google_id' => $googleAccount->getId(),
                'google_name' => $googleAccount->getName(),
                'email' => $googleAccount->getEmail(),
                'avatar' => $googleAccount->getAvatar(),
            ]);

            Auth::login($newUser);
        } else {
            $existingGoogleAccount->update([
                'google_name' => $googleAccount->getName(),
                'email' => $googleAccount->getEmail(),
                'avatar' => $googleAccount->getAvatar(),
            ]);

            Auth::login($existingGoogleAccount->user);
        }

        return redirect('/about');
    }
}
