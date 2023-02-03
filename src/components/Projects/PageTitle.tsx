"use client";
import React, { useState } from "react";
import { createContext, useContext } from "react";
import { unknown } from "zod";


export const PageTitle = () => {
    return (
            <div className="font-bold text-[#d9d8e1]">{title}</div>
    );
}
