<?php

namespace App\Http\Controllers;

use App\Models\GithubAccount;
use App\Models\GoogleAccount;
use App\Models\User;
use Auth;
use Illuminate\Http\Request;
use Laravel\Socialite\Facades\Socialite;

class LoginController extends Controller
{
    //
    public function showAuthOptions()
    {
        return view('login');
    }
    public function redirectToGoogle()
    {
        return Socialite::driver('google')->redirect();
    }
    public function handleGoogleCallback(Request $request)
    {
        // googleUser と　googleAccount を区別
        $googleUser = Socialite::driver('google')->user();

        $existingGoogleAccount = GoogleAccount::where('google_id', $googleUser->getId())->first();

        if (is_null($existingGoogleAccount)) {
            $user = User::create([
                'user_name' => $googleUser->getName(),
            ]);
            $googleAccount = GoogleAccount::create([
                'user_id' => $user->id,
                'google_id' => $googleUser->getId(),
                'google_name' => $googleUser->getName(),
                'email' => $googleUser->getEmail(),
                'avatar' => $googleUser->getAvatar(),
            ]);
        } else {
            $existingGoogleAccount->update([
                'google_name' => $googleUser->getName(),
                'email' => $googleUser->getEmail(),
                'avatar' => $googleUser->getAvatar(),
            ]);
            $user = $existingGoogleAccount->user;
        }
        Auth::login($user);
        return redirect()->route('top');
    }
    public function redirectToGithub()
    {
        return Socialite::driver('github')->redirect();
    }
    public function handleGithubCallback(Request $request)
    {
        $githubUser = Socialite::driver('github')->user();

        $existingGithubAccount = GithubAccount::where('github_id', $githubUser->getId())->first();

        if (is_null($existingGithubAccount)) {
            $user = User::create([
                'user_name' => $githubUser->getNickname(),
            ]);
            $githubAccount = GithubAccount::create([
                'user_id' => $user->id,
                'github_id' => $githubUser->getId(),
                'github_name' => $githubUser->getNickname(),
                'email' => $githubUser->getEmail(),
                'avatar' => $githubUser->getAvatar(),
            ]);
        } else {
            $existingGithubAccount->update([
                'github_name' => $githubUser->getNickname(),
                'email' => $githubUser->getEmail(),
                'avatar' => $githubUser->getAvatar(),
            ]);
            $user = $existingGithubAccount->user;
        }
        Auth::login($user);
        return redirect()->route('top');
    }
    public function logout()
    {
        Auth::logout();
        return redirect()->route('login');
    }
}
