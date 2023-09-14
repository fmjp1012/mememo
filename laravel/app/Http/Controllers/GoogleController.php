<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Laravel\Socialite\Facades\Socialite;
use App\Models\User;
use Auth;

class GoogleController extends Controller
{
    public function redirectToGoogle()
    {
        return Socialite::driver('google')->redirect();
    }

    public function handleGoogleCallback()
    {
        try {
            $user = Socialite::driver('google')->user();
        } catch (\Exception $e) {
            return redirect('/')->with('error', 'Google login failed');
        }

        // 以下はあなたのアプリケーションに合わせた処理を書く場所です。
        // 例えば、取得したGoogleのユーザー情報を使って、
        // データベースにユーザーを保存したり、
        // トークンを生成したり、セッションを設定するなど。

        $existingUser = User::where('email', $user->getEmail())->first();

        if ($existingUser) {
            Auth::login($existingUser);
        } else {
            $newUser = new User();
            $newUser->email = $user->getEmail();
            $newUser->name = $user->getName();
            $newUser->google_id = $user->getId();
            $newUser->save();

            Auth::login($newUser);
        }

        return redirect('/home');
    }
}
