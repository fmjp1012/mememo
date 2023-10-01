<?php

namespace App\Http\Controllers;

use Auth;
use Illuminate\Http\Request;

class TopController extends Controller
{
    //
    public function top()
    {
        return view('top');
    }
    public function create()
    {
        $user = Auth::user();
        return view('card.create', compact('user'));
    }
    public function study()
    {
        $user = Auth::user();
        $cards = $user->cards;
        return view('card.study', compact('user', 'cards'));
    }
    public function all()
    {
        return view('card.all');
    }
}
