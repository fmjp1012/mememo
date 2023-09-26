<?php

use App\Http\Controllers\CardController;
use App\Http\Controllers\GoogleController;
use App\Http\Controllers\LoginController;
use App\Http\Controllers\SignupController;
use App\Http\Controllers\TopController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "web" middleware group. Make something great!
|
*/
Route::get('welcome', function () {
    return view('welcome');
});

// 表示
Route::get('/login', [LoginController::class, 'showAuthOptions'])->name('login');

// Google
Route::get('/login/google', [LoginController::class, 'redirectToGoogle']);
Route::get('/login/google/callback', [LoginController::class, 'handleGoogleCallback']);
// Route::get('/logout/google')

// Github
Route::get('/login/github', [LoginController::class, 'redirectToGithub']);
Route::get('/login/github/callback', [LoginController::class, 'handleGithubCallback']);

Route::middleware(['auth'])->group(function () {
    Route::get('/', [TopController::class, 'top'])->name('top');
});
