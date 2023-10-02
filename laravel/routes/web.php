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
Route::get('/login', [LoginController::class, 'showAuthOptions'])->name('login');

// Google
Route::get('/login/google', [LoginController::class, 'redirectToGoogle']);
Route::get('/login/google/callback', [LoginController::class, 'handleGoogleCallback']);

// Github
Route::get('/login/github', [LoginController::class, 'redirectToGithub']);
Route::get('/login/github/callback', [LoginController::class, 'handleGithubCallback']);

// logout
Route::get('/logout', [LoginController::class, 'logout'])->name('logout');

Route::middleware(['auth'])->group(function () {
    // view
    Route::get('/', [TopController::class, 'index'])->name('top');
    Route::get('/card/create', [TopController::class, 'create'])->name('card.create');
    Route::get('/card/study', [TopController::class, 'study'])->name('card.study');
    Route::get('/card/{card}', [TopController::class, 'edit'])->name('card.edit');
    Route::get('/card', [TopController::class, 'index'])->name('card.index');

    // api
    Route::post('/card', [CardController::class, 'store'])->name('card.store');
    Route::put('/card/{card}', [CardController::class, 'update'])->name('card.update');
    Route::delete('/card/{card}', [CardController::class, 'delete'])->name('card.delete');
});
